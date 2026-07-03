// vanlife — cozy live tracker
// One worker: serves the map UI (static assets) + a tiny JSON API.
//
//   POST /api/ingest   store location points (Overland batches or simple JSON)
//   GET  /api/points   route history, oldest -> newest
//   GET  /api/photos   public iCloud shared album, cached ~10 min
//   GET  /api/config   trip name etc. for the frontend

const WEATHER_CURRENT =
  "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    let res;
    try {
      res = await handleApi(request, env, ctx, url);
    } catch (err) {
      res = json({ error: String(err.message || err) }, 500);
    }
    res = new Response(res.body, res); // make headers mutable (cache hits are immutable)
    res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  },
};

function handleApi(request, env, ctx, url) {
  const { pathname } = url;
  const method = request.method;
  if (pathname === "/api/ingest" && method === "POST") return ingest(request, env, url);
  if (pathname === "/api/points" && method === "GET") return getPoints(env, url);
  if (pathname === "/api/photos" && method === "GET") return getPhotos(env, ctx, url);
  if (pathname === "/api/config" && method === "GET") {
    return json({
      name: env.TRIP_NAME || "our little adventure",
      hasAlbum: Boolean(env.ALBUM_TOKEN),
    });
  }
  return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------- ingest ---

async function ingest(request, env, url) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const incoming = parseLocations(body)
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180 &&
        Number.isFinite(p.ts) &&
        p.ts > 0
    )
    .sort((a, b) => a.ts - b.ts);
  if (!incoming.length) return json({ result: "ok", stored: 0 });

  // drop points too close in time to the previous accepted one
  const minGap = Number(env.MIN_GAP_SECONDS || 120);
  const last = await env.DB.prepare("SELECT ts FROM points ORDER BY ts DESC LIMIT 1").first();
  let lastTs = last ? last.ts : 0;
  const accepted = [];
  for (const p of incoming) {
    if (p.ts - lastTs >= minGap) {
      accepted.push(p);
      lastTs = p.ts;
    }
  }
  if (!accepted.length) return json({ result: "ok", stored: 0 });

  // Weather changes slowly, and big Overland backlogs would blow the
  // subrequest budget — enrich an evenly-spaced subset, always incl. the latest.
  const step = Math.max(1, Math.ceil(accepted.length / 12));
  await Promise.allSettled(
    accepted.map((p, i) =>
      i % step === 0 || i === accepted.length - 1 ? enrich(p) : Promise.resolve()
    )
  );

  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO points
       (ts, lat, lon, elevation_m, temp_c, feels_c, humidity, wind_kmh, weather_code, speed_kmh, battery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    accepted.map((p) =>
      stmt.bind(
        p.ts,
        round(p.lat, 6),
        round(p.lon, 6),
        num(p.altitude),
        num(p.temp),
        num(p.feels),
        num(p.humidity),
        num(p.wind),
        num(p.wcode),
        num(p.speedKmh),
        num(p.battery)
      )
    )
  );
  // Overland treats {"result":"ok"} as the ack
  return json({ result: "ok", stored: accepted.length });
}

function parseLocations(body) {
  const now = Math.floor(Date.now() / 1000);

  // Overland / GeoJSON batch: {"locations":[{geometry, properties}, ...]}
  if (Array.isArray(body.locations)) {
    return body.locations.map((f) => {
      const [lon, lat] = f.geometry?.coordinates || [];
      const p = f.properties || {};
      return {
        lat: Number(lat),
        lon: Number(lon),
        ts: p.timestamp ? Math.floor(Date.parse(p.timestamp) / 1000) : now,
        altitude: num(p.altitude),
        speedKmh: p.speed != null && p.speed >= 0 ? p.speed * 3.6 : null,
        battery: p.battery_level != null ? Math.round(p.battery_level * 100) : null,
      };
    });
  }

  // simple format, e.g. from an iOS Shortcut:
  // {"lat": 61.5, "lon": 8.2, "altitude": 950, "battery": 80}
  const ts =
    typeof body.ts === "string" ? Math.floor(Date.parse(body.ts) / 1000) : Number(body.ts) || now;
  return [
    {
      lat: Number(body.lat ?? body.latitude),
      lon: Number(body.lon ?? body.lng ?? body.longitude),
      ts,
      altitude: num(body.altitude ?? body.alt),
      speedKmh: num(body.speed_kmh ?? body.speed),
      battery: num(body.battery),
    },
  ];
}

async function enrich(p) {
  const jobs = [
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
        `&current=${WEATHER_CURRENT}&wind_speed_unit=kmh`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const c = d?.current;
        if (!c) return;
        p.temp = c.temperature_2m;
        p.feels = c.apparent_temperature;
        p.humidity = c.relative_humidity_2m;
        p.wind = c.wind_speed_10m;
        p.wcode = c.weather_code;
      }),
  ];
  if (p.altitude == null) {
    jobs.push(
      fetch(`https://api.open-meteo.com/v1/elevation?latitude=${p.lat}&longitude=${p.lon}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (Array.isArray(d?.elevation)) p.altitude = d.elevation[0];
        })
    );
  }
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------- points ---

async function getPoints(env, url) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 5000, 10000);
  const since = Number(url.searchParams.get("since")) || 0;
  const cols = `ts, lat, lon, elevation_m AS ele, temp_c AS temp, feels_c AS feels,
                humidity AS hum, wind_kmh AS wind, weather_code AS wcode,
                speed_kmh AS speed, battery AS batt`;
  const q = since
    ? env.DB.prepare(`SELECT ${cols} FROM points WHERE ts > ? ORDER BY ts ASC LIMIT ?`).bind(since, limit)
    : env.DB.prepare(
        `SELECT * FROM (SELECT ${cols} FROM points ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC`
      ).bind(limit);
  const { results } = await q.all();
  const res = json({ points: results });
  res.headers.set("Cache-Control", "public, max-age=30");
  return res;
}

// ---------------------------------------------------------------- photos ---
// Reads the public web feed of an iCloud shared album ("sharedstreams" API).
// Asset URLs expire after a while, so we cache for only ~10 minutes.

async function getPhotos(env, ctx, url) {
  if (!env.ALBUM_TOKEN) {
    return json({ photos: [], note: "set ALBUM_TOKEN to sync an iCloud shared album" });
  }
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/photos`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const data = await fetchSharedAlbum(env.ALBUM_TOKEN);
  const res = json(data);
  res.headers.set("Cache-Control", "public, max-age=600");
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function fetchSharedAlbum(token) {
  const stream = await icloudPost("p01-sharedstreams.icloud.com", token, "webstream", {
    streamCtag: null,
  });
  const host = stream.host;

  const items = (stream.data.photos || [])
    .filter((p) => p.mediaAssetType !== "video")
    .sort((a, b) => Date.parse(a.dateCreated || 0) - Date.parse(b.dateCreated || 0))
    .slice(-300); // stay well under the worker subrequest budget

  const metas = [];
  for (const p of items) {
    const ds = Object.values(p.derivatives || {})
      .filter((d) => d.checksum)
      .sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0));
    if (!ds.length) continue;
    const thumb = ds.find((d) => Number(d.width) >= 250) || ds[ds.length - 1];
    const full = ds[ds.length - 1];
    metas.push({
      guid: p.photoGuid,
      caption: p.caption || "",
      by: p.contributorFullName || "",
      takenAt: p.dateCreated || p.batchDateCreated || null,
      width: Number(full.width) || null,
      height: Number(full.height) || null,
      thumbChecksum: thumb.checksum,
      fullChecksum: full.checksum,
    });
  }

  // resolve checksums -> signed URLs, in chunks
  const urls = {};
  const guids = metas.map((m) => m.guid);
  for (let i = 0; i < guids.length; i += 25) {
    const r = await icloudPost(host, token, "webasseturls", {
      photoGuids: guids.slice(i, i + 25),
    });
    for (const [checksum, v] of Object.entries(r.data.items || {})) {
      urls[checksum] = `https://${v.url_location}${v.url_path}`;
    }
  }

  return {
    album: stream.data.streamName || "",
    photos: metas
      .map((m) => ({
        guid: m.guid,
        caption: m.caption,
        by: m.by,
        takenAt: m.takenAt,
        width: m.width,
        height: m.height,
        thumb: urls[m.thumbChecksum] || urls[m.fullChecksum] || null,
        url: urls[m.fullChecksum] || null,
      }))
      .filter((p) => p.url),
  };
}

// Apple bounces requests to the right shard with a 330 + X-Apple-MMe-Host.
async function icloudPost(host, token, endpoint, payload) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "https://www.icloud.com" },
      body: JSON.stringify(payload),
    });
    if (res.status === 330) {
      const j = await res.json().catch(() => ({}));
      const next = j["X-Apple-MMe-Host"];
      if (!next) throw new Error("icloud: redirect without host");
      host = next;
      continue;
    }
    if (!res.ok) throw new Error(`icloud ${endpoint}: HTTP ${res.status}`);
    return { data: await res.json(), host };
  }
  throw new Error("icloud: too many redirects");
}

// ---------------------------------------------------------------- helpers ---

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, places) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
