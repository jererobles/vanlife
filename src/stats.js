// 📊 trip statistics — derived from the raw track, computed on the edge.
// Country attribution is offline point-in-polygon against vendored Natural
// Earth 110m borders; stop places come from Nominatim (heavily cached).

import world from "./data/countries-110m.json";

const MOVING_KMH = 8; // slower than this between points = not driving
const GAP_S = 45 * 60; // a logging gap this big breaks streaks
const STOP_RADIUS_KM = 0.4; // wiggle allowed while "stopped"
const MIN_STOP_S = 45 * 60; // shorter pauses aren't stops, just traffic
const GEOCODED_STOPS = 8; // only the longest stops get a place name

export async function statsHandler(env, ctx, url) {
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/stats`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const { results: pts } = await env.DB.prepare(
    `SELECT ts, lat, lon, elevation_m AS ele, temp_c AS temp, speed_kmh AS speed
     FROM points ORDER BY ts ASC LIMIT 10000`
  ).all();

  const stats = computeStats(pts);
  if (stats) {
    // name the longest stops (cached ~forever per spot, so this is cheap)
    const named = await Promise.all(
      stats.stops.slice(0, GEOCODED_STOPS).map(async (s) => ({
        ...s,
        place: await reverseGeocode(s.lat, s.lon).catch(() => null),
      }))
    );
    const cityTime = new Map();
    for (const s of named) {
      if (!s.place) continue;
      const e = cityTime.get(s.place) || 0;
      cityTime.set(s.place, e + s.seconds);
    }
    const top = [...cityTime.entries()].sort((a, b) => b[1] - a[1])[0];
    stats.topCity = top ? { name: top[0], seconds: top[1] } : null;
    stats.longestStop = named[0]
      ? { ...named[0] }
      : stats.stops[0] || null;
    delete stats.stops;
  }

  const res = new Response(JSON.stringify(stats), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function computeStats(pts) {
  if (pts.length < 2) return null;

  let totalKm = 0, movingS = 0, movingKm = 0;
  let topSpeed = null;
  let drive = null, longestDrive = null;
  const countries = new Map();
  const dayKm = new Map();
  let highest = null, hottest = null, coldest = null, northernmost = null;

  for (const p of pts) {
    if (p.ele != null && (!highest || p.ele > highest.ele)) highest = { ele: p.ele, ts: p.ts };
    if (p.temp != null && (!hottest || p.temp > hottest.temp)) hottest = { temp: p.temp, ts: p.ts };
    if (p.temp != null && (!coldest || p.temp < coldest.temp)) coldest = { temp: p.temp, ts: p.ts };
    if (!northernmost || p.lat > northernmost.lat) northernmost = { lat: p.lat, lon: p.lon, ts: p.ts };
  }

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dt = b.ts - a.ts;
    const km = haversineKm(a, b);
    const gap = dt > GAP_S;
    const v = dt > 0 ? (km / dt) * 3600 : 0;
    totalKm += km;

    // fastest moment: trust the device speed; positional speed only fills in
    // when neither endpoint reported one — a stale fix (old position, fresh
    // timestamp) makes the interval look far faster than the device ever went
    if (b.speed != null && b.speed < 250 && b.speed > (topSpeed?.kmh || 0))
      topSpeed = { kmh: b.speed, ts: b.ts };
    if (a.speed == null && b.speed == null && !gap && dt >= 120 && v < 200 && v > (topSpeed?.kmh || 0))
      topSpeed = { kmh: v, ts: b.ts };

    const isMoving = !gap && v >= MOVING_KMH;
    if (isMoving) {
      movingS += dt;
      movingKm += km;
      if (!drive) drive = { startTs: a.ts, endTs: b.ts, km: 0 };
      drive.endTs = b.ts;
      drive.km += km;
      if (!longestDrive || drive.endTs - drive.startTs > longestDrive.seconds) {
        longestDrive = { seconds: drive.endTs - drive.startTs, km: drive.km, startTs: drive.startTs };
      }
    } else {
      drive = null;
    }

    // time per country, attributed to where the interval started; logging
    // gaps are skipped — we don't know where the van was in between
    if (!gap) {
      const c = countryAt(a.lat, a.lon);
      if (c) {
        const e = countries.get(c) || { seconds: 0, km: 0 };
        e.seconds += dt;
        e.km += km;
        countries.set(c, e);
      }
    }

    const day = new Date(a.ts * 1000).toISOString().slice(0, 10);
    dayKm.set(day, (dayKm.get(day) || 0) + km);
  }

  // stops: consecutive points that stay within a small circle
  const stops = [];
  let s = null;
  for (const p of pts) {
    if (s && haversineKm(s, p) <= STOP_RADIUS_KM) s.endTs = p.ts;
    else {
      if (s && s.endTs - s.startTs >= MIN_STOP_S) stops.push(finishStop(s));
      s = { lat: p.lat, lon: p.lon, startTs: p.ts, endTs: p.ts };
    }
  }
  if (s && s.endTs - s.startTs >= MIN_STOP_S) stops.push(finishStop(s));
  stops.sort((a, b) => b.seconds - a.seconds);

  let chillDays = 0, driveDays = 0;
  for (const km of dayKm.values()) km < 5 ? chillDays++ : driveDays++;

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    totalKm: Math.round(totalKm),
    movingHours: Math.round((movingS / 3600) * 10) / 10,
    avgMovingKmh: movingS > 600 ? Math.round(movingKm / (movingS / 3600)) : null,
    topSpeed: topSpeed && { kmh: Math.round(topSpeed.kmh), ts: topSpeed.ts },
    longestDrive,
    stops: stops.slice(0, 20),
    countries: [...countries.entries()]
      .map(([name, e]) => ({ name, iso2: ISO2[name] || null, seconds: e.seconds, km: Math.round(e.km) }))
      .sort((a, b) => b.seconds - a.seconds),
    highest,
    hottest,
    coldest,
    northernmost,
    chillDays,
    driveDays,
  };
}

const finishStop = (s) => ({ lat: s.lat, lon: s.lon, startTs: s.startTs, seconds: s.endTs - s.startTs });

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ----------------------------------------------------- reverse geocoding ---
// one lookup per unique-ish spot, cached for a month

async function reverseGeocode(lat, lon) {
  const key = new Request(
    `https://geocode.cache/v1?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`
  );
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return (await hit.json()).place;

  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`,
    { headers: { "User-Agent": "vanlife-tracker/1.0 (cozy van map; github.com/jererobles/vanlife)" } }
  );
  if (!res.ok) return null;
  const a = (await res.json()).address || {};
  const place = a.city || a.town || a.village || a.municipality || a.county || null;
  await cache.put(
    key,
    new Response(JSON.stringify({ place }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=2592000" },
    })
  );
  return place;
}

// -------------------------------------------- offline country attribution ---
// Natural Earth 110m borders, TopoJSON-decoded on first use. Coarse borders
// (±10 km) are fine for "how long were we in Sweden".

let FEATURES = null;
const cellCache = new Map(); // 0.05° cell -> country name

function countryAt(lat, lon) {
  const cell = `${Math.round(lat * 20)},${Math.round(lon * 20)}`;
  if (cellCache.has(cell)) return cellCache.get(cell);
  if (!FEATURES) FEATURES = decodeTopo(world);
  let found = null;
  for (const f of FEATURES) {
    const bb = f.bbox;
    if (lat < bb[1] || lat > bb[3] || lon < bb[0] || lon > bb[2]) continue;
    if (polysContain(f.polygons, lon, lat)) {
      found = f.name;
      break;
    }
  }
  cellCache.set(cell, found);
  return found;
}

function decodeTopo(topo) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const ring = (arcIdxs) => {
    const pts = [];
    for (const i of arcIdxs) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      pts.push(...a);
    }
    return pts;
  };
  return topo.objects.countries.geometries.map((g) => {
    // polygons: array of rings (outer + holes); even-odd handles both
    const polys =
      g.type === "Polygon"
        ? [g.arcs.map(ring)]
        : g.arcs.map((p) => p.map(ring));
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const p of polys)
      for (const r of p)
        for (const [x, y] of r) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    return { name: g.properties.name, polygons: polys, bbox: [minX, minY, maxX, maxY] };
  });
}

function polysContain(polys, x, y) {
  for (const rings of polys) {
    let inside = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

// world-atlas strips ISO codes, so map the names we're likely to roll through
const ISO2 = {
  Finland: "FI", Sweden: "SE", Norway: "NO", Denmark: "DK", Germany: "DE",
  Estonia: "EE", Latvia: "LV", Lithuania: "LT", Poland: "PL", Netherlands: "NL",
  Belgium: "BE", France: "FR", Spain: "ES", Portugal: "PT", Italy: "IT",
  Switzerland: "CH", Austria: "AT", Czechia: "CZ", Slovakia: "SK", Hungary: "HU",
  Slovenia: "SI", Croatia: "HR", Luxembourg: "LU", Ireland: "IE",
  "United Kingdom": "GB", Iceland: "IS", Greece: "GR", Romania: "RO",
  Bulgaria: "BG", Serbia: "RS", "Bosnia and Herz.": "BA", Macedonia: "MK",
  Albania: "AL", Montenegro: "ME", Kosovo: "XK", Ukraine: "UA", Moldova: "MD",
  Turkey: "TR", Morocco: "MA",
};
