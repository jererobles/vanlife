// vanlife — cozy live tracker
// One worker: serves the map UI (static assets) + a tiny JSON API.
//
//   POST /api/ingest   store location points (Overland batches or simple JSON)
//   GET  /api/points   route history, oldest -> newest
//   GET  /api/photos   public iCloud shared album, cached ~10 min
//   GET  /api/config   trip name etc. for the frontend

import { statsHandler } from "./stats.js";

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
  if (pathname === "/api/backfill" && method === "POST") return backfill(request, env, url);
  if (pathname === "/api/points" && method === "GET") return getPoints(env, url);
  if (pathname === "/api/photos" && method === "GET") return getPhotos(env, ctx, url);
  if (pathname === "/api/stats" && method === "GET") return statsHandler(env, ctx, url);
  if (pathname === "/api/config" && method === "GET") {
    return json({
      name: env.TRIP_NAME || "our little adventure",
      hasAlbum: Boolean(env.ALBUM_TOKEN),
      tipUrl: env.TIP_URL || null,
    });
  }
  return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------- ingest ---

function authorized(request, env, url) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  return Boolean(env.INGEST_TOKEN) && token === env.INGEST_TOKEN;
}

async function ingest(request, env, url) {
  if (!authorized(request, env, url)) return json({ error: "unauthorized" }, 401);

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

// -------------------------------------------------------------- backfill ---
// Retroactive points (e.g. GPS pulled from camera-roll photos via /import.html).
// Ingest only accepts points newer than the latest one, so this is a separate
// path: dedupe purely on the ts UNIQUE constraint, and look up the weather
// that was actually happening at that time and place.

async function backfill(request, env, url) {
  if (!authorized(request, env, url)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const points = (Array.isArray(body.points) ? body.points : [])
    .map((p) => ({
      lat: Number(p.lat),
      lon: Number(p.lon),
      ts: Math.floor(Number(p.ts)),
      altitude: num(p.altitude),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180 &&
        Number.isFinite(p.ts) &&
        p.ts > 946684800 && // sanity: after year 2000
        p.ts <= now + 300
    )
    .slice(0, 20); // each point costs up to 2 lookups; stay under the subrequest cap
  if (!points.length) return json({ stored: 0, received: 0 });

  await Promise.allSettled(points.map(enrichHistorical));

  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO points
       (ts, lat, lon, elevation_m, temp_c, feels_c, humidity, wind_kmh, weather_code, speed_kmh, battery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  );
  const results = await env.DB.batch(
    points.map((p) =>
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
        null
      )
    )
  );
  const stored = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
  return json({ stored, received: points.length, duplicates: points.length - stored });
}

// hourly weather for a past moment: recent past comes from the forecast API's
// past_days window, older than ~3 months from the ERA5 archive
async function enrichHistorical(p) {
  const day = 86400;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - p.ts);
  const date = new Date(p.ts * 1000).toISOString().slice(0, 10);
  const wUrl =
    age < 88 * day
      ? `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
        `&hourly=${WEATHER_CURRENT}&past_days=${Math.min(92, Math.ceil(age / day) + 1)}` +
        `&forecast_days=1&wind_speed_unit=kmh&timezone=UTC`
      : `https://archive-api.open-meteo.com/v1/archive?latitude=${p.lat}&longitude=${p.lon}` +
        `&start_date=${date}&end_date=${date}&hourly=${WEATHER_CURRENT}&wind_speed_unit=kmh&timezone=UTC`;

  const jobs = [
    fetch(wUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const h = d?.hourly;
        if (!h?.time?.length) return;
        let best = 0,
          bestDiff = Infinity;
        for (let i = 0; i < h.time.length; i++) {
          const diff = Math.abs(Date.parse(h.time[i] + ":00Z") / 1000 - p.ts);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
          }
        }
        if (bestDiff > 2 * 3600) return;
        p.temp = h.temperature_2m?.[best];
        p.feels = h.apparent_temperature?.[best];
        p.humidity = h.relative_humidity_2m?.[best];
        p.wind = h.wind_speed_10m?.[best];
        p.wcode = h.weather_code?.[best];
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
// Stale-while-revalidate: viewers always get an instant cached answer; a
// background refresh keeps the signed asset URLs fresh (they expire in hours).

const PHOTOS_FRESH_S = 600; // refresh in the background after this
const PHOTOS_USABLE_S = 3 * 3600; // serve stale up to this long (URLs still valid)

async function getPhotos(env, ctx, url) {
  if (!env.ALBUM_TOKEN) {
    return json({ photos: [], note: "set ALBUM_TOKEN to sync an iCloud shared album" });
  }
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/photos`);

  const refresh = async () => {
    const data = await fetchSharedAlbum(env.ALBUM_TOKEN);
    const res = json(data);
    res.headers.set("Cache-Control", `public, max-age=${PHOTOS_USABLE_S}`);
    res.headers.set("X-Fetched-At", String(Date.now()));
    await cache.put(cacheKey, res.clone());
    return res;
  };

  const hit = await cache.match(cacheKey);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get("X-Fetched-At") || 0)) / 1000;
    if (age < PHOTOS_USABLE_S) {
      if (age > PHOTOS_FRESH_S) ctx.waitUntil(refresh().catch(() => {}));
      return hit;
    }
  }
  return refresh();
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
    // smallest real derivative — markers are tiny, so favor the lightest file
    const thumb = ds.find((d) => Number(d.width) > 0) || ds[0];
    const full = ds[ds.length - 1];
    metas.push({
      guid: p.photoGuid,
      caption: p.caption || "",
      by: p.contributorFullName || "",
      // dateCreated is the capture time; batchDateCreated is only when it was
      // added to the album — never use that for placing photos on the route
      takenAt: p.dateCreated || null,
      width: Number(full.width) || null,
      height: Number(full.height) || null,
      thumbChecksum: thumb.checksum,
      fullChecksum: full.checksum,
    });
  }

  // resolve checksums -> signed URLs; chunks fetched in parallel
  const urls = {};
  const guids = metas.map((m) => m.guid);
  const chunks = [];
  for (let i = 0; i < guids.length; i += 25) chunks.push(guids.slice(i, i + 25));
  const results = await Promise.all(
    chunks.map((c) => icloudPost(host, token, "webasseturls", { photoGuids: c }))
  );
  for (const r of results) {
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
