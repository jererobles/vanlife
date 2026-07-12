// vanlife map 🚐💕
// fetches /api/points + /api/photos, draws a pastel route with photo polaroids

const POINTS_EVERY_MS = 60_000;
const PHOTOS_EVERY_MS = 10 * 60_000;
const PHOTO_MATCH_WINDOW_S = 12 * 3600; // photo must be within 12h of a track point
const TRIP_RANGE_MARGIN_S = 30 * 60; // ...and taken during the tracked journey (± this margin)

// WMO weather codes -> cozy emoji + translatable words
const WEATHER = [
  [[0], "☀️", "w_sunny"],
  [[1], "🌤️", "w_mostly"],
  [[2], "⛅", "w_partly"],
  [[3], "☁️", "w_cloudy"],
  [[45, 48], "🌫️", "w_foggy"],
  [[51, 53, 55, 56, 57], "🌦️", "w_drizzly"],
  [[61, 63, 65, 66, 67], "🌧️", "w_rainy"],
  [[71, 73, 75, 77], "❄️", "w_snowy"],
  [[80, 81, 82], "🌧️", "w_showers"],
  [[85, 86], "🌨️", "w_snowshowers"],
  [[95, 96, 99], "⛈️", "w_stormy"],
];

function weatherLook(code) {
  if (code == null) return ["✨", t("w_adventuring")];
  for (const [codes, emoji, key] of WEATHER) if (codes.includes(code)) return [emoji, t(key)];
  return ["🌈", t("w_mystery")];
}

// ------------------------------------------------------------------ map ---

const map = L.map("map", { zoomControl: false, attributionControl: true });
L.control.zoom({ position: "bottomright" }).addTo(map);

// tiles follow the system theme: sunny voyager by day, cozy dark by night 🌙
const TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const tileLayer = L.tileLayer(TILE_URLS[darkQuery.matches ? "dark" : "light"], {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 20,
}).addTo(map);
darkQuery.addEventListener("change", (e) => tileLayer.setUrl(TILE_URLS[e.matches ? "dark" : "light"]));

map.setView([54, 10], 4); // placeholder view until points arrive

const routeCasing = L.polyline([], { color: "#ffffff", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: "#f4a9c7", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
// invisible fat line on top of the route: an easy hover/tap target that
// summons the nearest track point without littering the map with dots
const hitLine = L.polyline([], { weight: 28, opacity: 0, lineCap: "round", lineJoin: "round" }).addTo(map);
const stayLayer = L.layerGroup().addTo(map);
const photoLayer = L.layerGroup().addTo(map);

const vanIcon = L.divIcon({
  className: "van-icon",
  html: '<span class="van-emoji">🚐</span>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});
const VAN_ZOOM = 12; // the "where are they right now" zoom
let vanMarker = null;
let didFitOnce = false;
let latestPoints = [];
let lastPointTs = null;

// -------------------------------------------------------------- helpers ---

const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString(LOCALE, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function timeAgo(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return t("justNow");
  if (s < 3600) return t("minAgo", { n: Math.round(s / 60) });
  if (s < 172800) return t("hAgo", { n: Math.round(s / 3600) });
  return t("dAgo", { n: Math.round(s / 86400) });
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// nearest track point in time (points sorted asc by ts)
function nearestPoint(points, ts) {
  if (!points.length) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  const cands = [points[lo], points[Math.max(0, lo - 1)]];
  cands.sort((a, b) => Math.abs(a.ts - ts) - Math.abs(b.ts - ts));
  return Math.abs(cands[0].ts - ts) <= PHOTO_MATCH_WINDOW_S ? cands[0] : null;
}

// deterministic small number from a string, for polaroid tilt + stacking offsets
function hashish(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

// -------------------------------------------------------------- renders ---

function renderPoints(points) {
  latestPoints = points;
  $("empty-card").hidden = points.length > 0;
  if (!points.length) return;

  const latlngs = points.map((p) => [p.lat, p.lon]);
  routeCasing.setLatLngs(latlngs);
  routeLine.setLatLngs(latlngs);
  hitLine.setLatLngs(latlngs);

  const last = points[points.length - 1];
  const lastLL = [last.lat, last.lon];
  if (!vanMarker) vanMarker = L.marker(lastLL, { icon: vanIcon, zIndexOffset: 2000 }).addTo(map);
  else vanMarker.setLatLng(lastLL);

  if (!didFitOnce) {
    map.setView(lastLL, VAN_ZOOM); // open right where the van is
    didFitOnce = true;
  } else if (lastPointTs !== null && last.ts !== lastPointTs) {
    map.panTo(lastLL); // gently follow when a fresh point arrives
  }
  lastPointTs = last.ts;

  renderNowCard(last);
  renderStats(points);
  renderStays(points);
}

// ----------------------------------------------------- overnight stays ---
// spots where the van slept get a little moon. The tracker usually goes
// quiet at night, so each night is found between CONSECUTIVE points: when
// a pair spans ~3am local sun time (longitude/15 gives the offset, no
// timezone tables), the camp is the earlier point — the last thing the
// tracker said that day. Driving straight through the night doesn't count:
// a 3am pair mid-drive has a short gap AND real distance between points.

const STAY_RADIUS_KM = 0.4; // same-spot wiggle room
const NIGHT_ANCHOR_S = 3 * 3600; // ~3am, deepest-sleep o'clock
const NIGHT_GAP_MIN_S = 3 * 3600; // tracker silent this long = resting, not rolling

function computeStays(points) {
  const stays = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const offset = (a.lon / 15) * 3600;
    const aIdx = Math.floor((a.ts + offset - NIGHT_ANCHOR_S) / 86400);
    const bIdx = Math.floor((b.ts + offset - NIGHT_ANCHOR_S) / 86400);
    if (bIdx <= aIdx) continue; // no 3am passed between these two points
    if (b.ts - a.ts < NIGHT_GAP_MIN_S && haversineKm(a, b) > STAY_RADIUS_KM) continue; // night drive

    const nights = bIdx - aIdx; // a multi-day silence = several nights here
    const spot = stays.find((x) => haversineKm(x, a) <= STAY_RADIUS_KM);
    if (!spot) {
      stays.push({ lat: a.lat, lon: a.lon, nights, lastIdx: bIdx, visits: [{ startTs: a.ts, nights }] });
      continue;
    }
    spot.nights += nights;
    // back-to-back nights at the same spot are one visit; a return trip
    // weeks later gets its own line in the popup
    if (aIdx === spot.lastIdx) spot.visits[spot.visits.length - 1].nights += nights;
    else spot.visits.push({ startTs: a.ts, nights });
    spot.lastIdx = bIdx;
  }
  return stays;
}

const stayMarkers = new Map(); // "lat,lon" -> {marker, nights}

function renderStays(points) {
  const seen = new Set();
  for (const st of computeStays(points)) {
    const key = `${st.lat.toFixed(4)},${st.lon.toFixed(4)}`;
    seen.add(key);
    const kept = stayMarkers.get(key);
    if (kept && kept.nights === st.nights) continue; // same spot, same story
    if (kept) stayLayer.removeLayer(kept.marker);

    const icon = L.divIcon({
      className: "stay-marker",
      html: `<span class="moon">⛺️</span>${
        st.nights > 1 ? `<span class="count">${st.nights}</span>` : ""
      }`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -16],
    });
    const marker = L.marker([st.lat, st.lon], { icon, zIndexOffset: 500 }).bindPopup(() => {
      const lines = st.visits.map((v) => `⛺ ${fmtDay(v.startTs)} · ${tn("nights", v.nights)}`);
      return `<div class="point-pop"><p class="head">🌙 ${t("stayTitle")}</p><p class="meta">${lines.join("<br>")}</p></div>`;
    });
    marker.addTo(stayLayer);
    stayMarkers.set(key, { marker, nights: st.nights });
  }

  // spots that fell off the visible window (or got re-clustered) fade away
  for (const [key, kept] of stayMarkers) {
    if (!seen.has(key)) {
      stayLayer.removeLayer(kept.marker);
      stayMarkers.delete(key);
    }
  }
}

// ------------------------------------------------------- route peeking ---
// hover (or tap) the route to reveal the nearest real track point; the raw
// points stay off-screen so the map looks calm while the path stays honest

const peekDot = L.circleMarker([0, 0], {
  radius: 6, color: "#fff", weight: 2.5, fillColor: "#cbb7f0", fillOpacity: 1,
  interactive: false,
});
peekDot.bindTooltip("", { direction: "top", offset: [0, -8], className: "peek-tip", opacity: 1 });

// nearest track point to a latlng, in flat-ish degree space (plenty for snapping)
function nearestPointToLatLng(ll) {
  const cos = Math.cos((ll.lat * Math.PI) / 180);
  let best = null, bd = Infinity;
  for (const p of latestPoints) {
    const dLat = p.lat - ll.lat;
    const dLon = (p.lon - ll.lng) * cos;
    const d = dLat * dLat + dLon * dLon;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function pointInfo(p) {
  const [emoji] = weatherLook(p.wcode);
  const bits = [fmtTime(p.ts)];
  if (p.temp != null) bits.push(`${Math.round(p.temp)}°C ${emoji}`);
  if (p.ele != null) bits.push(`⛰ ${Math.round(p.ele)} m`);
  if (p.speed != null && p.speed > 2) bits.push(`🛞 ${Math.round(p.speed)} km/h`);
  return bits.join(" · ");
}

let peekPending = false;
hitLine.on("mousemove", (e) => {
  if (peekPending) return; // one snap per frame is plenty
  peekPending = true;
  requestAnimationFrame(() => {
    peekPending = false;
    const p = nearestPointToLatLng(e.latlng);
    if (!p) return;
    peekDot.setLatLng([p.lat, p.lon]);
    if (!map.hasLayer(peekDot)) peekDot.addTo(map);
    peekDot.setTooltipContent(pointInfo(p));
    peekDot.openTooltip();
  });
});

hitLine.on("mouseout", () => {
  if (map.hasLayer(peekDot)) map.removeLayer(peekDot);
});

// tap (mobile) or click: a sticky popup version of the same peek
hitLine.on("click", (e) => {
  L.DomEvent.stop(e);
  const p = nearestPointToLatLng(e.latlng);
  if (!p) return;
  L.popup({ offset: [0, -4] })
    .setLatLng([p.lat, p.lon])
    .setContent(
      `<div class="point-pop"><p class="head">${t("alongTheWay")}</p><p class="meta">${pointInfo(p)}</p></div>`
    )
    .openOn(map);
});

function renderNowCard(p) {
  const [emoji, word] = weatherLook(p.wcode);
  $("now-emoji").textContent = emoji;
  $("now-temp").textContent = p.temp != null ? `${Math.round(p.temp)}°C` : "—";
  $("now-desc").textContent = word;

  const chips = [];
  if (p.ele != null) chips.push(`⛰ ${Math.round(p.ele)} m`);
  if (p.wind != null) chips.push(`🍃 ${Math.round(p.wind)} km/h`);
  if (p.hum != null) chips.push(`💧 ${Math.round(p.hum)}%`);
  if (p.feels != null) chips.push(t("feels", { n: Math.round(p.feels) }));
  if (p.speed != null && p.speed > 2) chips.push(t("cruising", { n: Math.round(p.speed) }));
  if (p.batt != null) chips.push(`🔋 ${Math.round(p.batt)}%`);
  $("now-chips").innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join("");

  $("now-updated").textContent = t("updated", { t: timeAgo(p.ts) });
  $("now-card").hidden = false;
}

function renderStats(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  const days = Math.floor((points[points.length - 1].ts - points[0].ts) / 86400) + 1;
  const parts = [
    t("km", { n: km >= 100 ? Math.round(km).toLocaleString(LOCALE) : km.toFixed(1) }),
    t("day", { n: days }),
  ];
  if (photoCount > 0) parts.push(tn("photos", photoCount));
  $("stats").innerHTML = parts.map((s) => `<span>${s}</span>`).join("");
}

let photoCount = 0;
let unplacedPhotos = [];
const photoMarkers = new Map(); // cluster key -> {marker, entry, lat, lon}

const PHOTO_BOX = 52; // longest side of a polaroid, px
const PHOTO_STEM = 12; // room under the frame for the gps dot
const CLUSTER_PX = 64; // photos closer than this on screen huddle into a stack

function renderPhotos(photos) {
  photoCount = 0;
  unplacedPhotos = [];

  // Apple strips GPS from public shared albums, so placement works by capture
  // time. A photo taken outside the tracked journey has no honest spot on the
  // route — it goes to the shoebox instead of being pinned somewhere the van
  // merely was later.
  const first = latestPoints[0];
  const last = latestPoints[latestPoints.length - 1];

  const placed = [];
  for (const photo of photos) {
    if (!photo.thumb) continue;
    const ts = photo.takenAt ? Math.floor(Date.parse(photo.takenAt) / 1000) : null;
    const inTrip =
      ts && first && ts >= first.ts - TRIP_RANGE_MARGIN_S && ts <= last.ts + TRIP_RANGE_MARGIN_S;
    const at = inTrip ? nearestPoint(latestPoints, ts) : null;
    if (!at) {
      unplacedPhotos.push(photo);
      continue;
    }
    placed.push({ photo, ts, lat: at.lat, lon: at.lon });
    photoCount++;
  }

  // photos that would overlap at this zoom huddle into little stacks;
  // zooming in re-clusters, so stacks naturally fall apart into polaroids
  const zoom = map.getZoom();
  const clusters = [];
  for (const pl of placed) {
    const px = map.project([pl.lat, pl.lon], zoom);
    const home = clusters.find((c) => c.px.distanceTo(px) < CLUSTER_PX);
    if (home) {
      const k = home.members.length;
      home.px = home.px.multiplyBy(k / (k + 1)).add(px.multiplyBy(1 / (k + 1)));
      home.members.push(pl);
    } else {
      clusters.push({ px, members: [pl] });
    }
  }

  const seen = new Set();
  for (const c of clusters) {
    c.members.sort((a, b) => a.ts - b.ts);
    const key = c.members.map((m) => m.photo.guid).sort().join("|");
    seen.add(key);
    const center = map.unproject(c.px, zoom);
    const lat = c.members.length === 1 ? c.members[0].lat : center.lat;
    const lon = c.members.length === 1 ? c.members[0].lon : center.lng;

    // same cluster as before: keep the marker (and its already-loaded images) —
    // recreating them every refresh made the browser re-download thumbnails
    // whenever the signed URLs rotated
    const kept = photoMarkers.get(key);
    if (kept) {
      if (kept.lat !== lat || kept.lon !== lon) {
        kept.marker.setLatLng([lat, lon]);
        kept.lat = lat;
        kept.lon = lon;
      }
      kept.entry.members = c.members; // popups/galleries use the freshest URLs
      continue;
    }

    const entry = { members: c.members };
    const marker =
      c.members.length === 1 ? singlePhotoMarker(entry) : stackMarker(entry);
    marker.setLatLng([lat, lon]).addTo(photoLayer);
    photoMarkers.set(key, { marker, entry, lat, lon });

    // fade in once loaded (the frame shimmers until then), and if a cached
    // signed URL has expired, retry with the latest one
    const img = marker.getElement()?.querySelector("img");
    if (img) {
      if (img.complete && img.naturalWidth) img.classList.add("loaded");
      else img.addEventListener("load", () => img.classList.add("loaded"));
      img.addEventListener("error", () => {
        const fresh = entry.members[entry.members.length - 1].photo.thumb;
        if (img.src !== fresh) img.src = fresh;
      });
    }
  }

  // clusters that dissolved (zoom change, album edits) fade away
  for (const [key, kept] of photoMarkers) {
    if (!seen.has(key)) {
      photoLayer.removeLayer(kept.marker);
      photoMarkers.delete(key);
    }
  }

  if (latestPoints.length) renderStats(latestPoints);
  renderShoebox();
}

function polaroidBox(photo) {
  let w = PHOTO_BOX, h = PHOTO_BOX;
  if (photo.width && photo.height) {
    const ar = photo.width / photo.height;
    if (ar >= 1) h = Math.max(32, Math.round(PHOTO_BOX / ar));
    else w = Math.max(32, Math.round(PHOTO_BOX * ar));
  }
  return [w, h];
}

// one photo: a tilted polaroid over its gps dot, tap for the big version
function singlePhotoMarker(entry) {
  const m = entry.members[0];
  const [w, h] = polaroidBox(m.photo);
  const tilt = (hashish(m.photo.guid) % 13) - 6;
  const icon = L.divIcon({
    className: "photo-marker",
    html: `<div class="frame" style="--tilt:${tilt}deg"><img src="${m.photo.thumb}" loading="lazy" decoding="async" alt=""></div><span class="gps-dot"></span>`,
    iconSize: [w, h + PHOTO_STEM],
    iconAnchor: [w / 2, h + PHOTO_STEM - 5], // the gps dot sits exactly on the spot
    popupAnchor: [0, -(h + PHOTO_STEM)],
  });
  return L.marker([0, 0], { icon, zIndexOffset: 1000 }).bindPopup(
    () => photoPopupHtml(entry.members[0].photo, entry.members[0].ts),
    { maxWidth: 260 }
  );
}

// several photos at one stop: a little pile with a count, tap for the gallery
function stackMarker(entry) {
  const newest = entry.members[entry.members.length - 1];
  const [w, h] = polaroidBox(newest.photo);
  const icon = L.divIcon({
    className: "photo-marker photo-stack",
    html: `
      <div class="frame ghost" style="--tilt:9deg"></div>
      <div class="frame ghost" style="--tilt:-8deg"></div>
      <div class="frame" style="--tilt:-2deg"><img src="${newest.photo.thumb}" loading="lazy" decoding="async" alt=""></div>
      <span class="count">${entry.members.length}</span>
      <span class="gps-dot"></span>`,
    iconSize: [w, h + PHOTO_STEM],
    iconAnchor: [w / 2, h + PHOTO_STEM - 5],
  });
  return L.marker([0, 0], { icon, zIndexOffset: 1200 }).on("click", () => {
    openGallery(
      t("stackTitle"),
      t("stackSub", { n: entry.members.length }),
      entry.members.map((m) => m.photo).reverse() // newest first
    );
  });
}

// built on-demand when a popup opens, so the full-size image is only
// fetched for photos someone actually taps
function photoPopupHtml(photo, ts) {
  const meta = [];
  if (photo.by) meta.push(t("by", { name: photo.by }));
  meta.push(fmtTime(ts));
  const dims =
    photo.width && photo.height ? `width="${photo.width}" height="${photo.height}"` : "";
  return `<div class="photo-pop">
      <img src="${photo.url}" ${dims} decoding="async" alt="">
      ${photo.caption ? `<p class="cap">${escapeHtml(photo.caption)}</p>` : ""}
      <p class="meta">📸 ${meta.map(escapeHtml).join(" · ")}</p>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ------------------------------------------------- shoebox & lightbox ---
// album photos that can't be placed on the route live in a cozy gallery

function renderShoebox() {
  const btn = $("pile-btn");
  btn.hidden = unplacedPhotos.length === 0;
  if (unplacedPhotos.length) btn.textContent = t("shoebox", { n: unplacedPhotos.length });
}

// one overlay, two moods: the shoebox and "photos from this stop"
function openGallery(title, sub, photos) {
  $("gallery-title").textContent = title;
  $("gallery-sub").textContent = sub;
  const grid = $("gallery-grid");
  grid.innerHTML = "";
  for (const photo of photos) {
    const img = document.createElement("img");
    img.className = "shimmer";
    img.src = photo.thumb;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = photo.caption || "";
    img.style.transform = `rotate(${(hashish(photo.guid) % 7) - 3}deg)`;
    img.addEventListener("load", () => img.classList.remove("shimmer"));
    img.addEventListener("click", () => openLightbox(photo));
    grid.appendChild(img);
  }
  $("gallery").hidden = false;
}

function openLightbox(photo) {
  const box = $("lightbox");
  box.querySelector("img").src = photo.url;
  box.querySelector(".cap").textContent =
    [photo.caption, photo.takenAt ? fmtTime(Math.floor(Date.parse(photo.takenAt) / 1000)) : ""]
      .filter(Boolean)
      .join(" · ") || "💕";
  box.hidden = false;
}

$("pile-btn").addEventListener("click", () =>
  openGallery(t("shoeboxTitle"), t("shoeboxSub"), [...unplacedPhotos].reverse())
);
$("gallery-close").addEventListener("click", () => ($("gallery").hidden = true));
$("gallery").addEventListener("click", (e) => {
  if (e.target === $("gallery")) $("gallery").hidden = true;
});
$("lightbox").addEventListener("click", () => ($("lightbox").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("lightbox").hidden = true;
    $("gallery").hidden = true;
    $("stats-overlay").hidden = true;
  }
});

// re-hug the whole route when someone wanders off across the map
$("recenter-btn").addEventListener("click", () => {
  if (latestPoints.length) map.fitBounds(routeLine.getBounds().pad(0.15), { maxZoom: 13 });
});

// ---------------------------------------------------------- stats panel ---
// little numbers from the road, computed by the worker from the raw track

let statsCache = null, statsCachedAt = 0;

$("stats-btn").addEventListener("click", async () => {
  $("stats-overlay").hidden = false;
  const body = $("stats-body");
  if (!statsCache || Date.now() - statsCachedAt > 5 * 60_000) {
    body.innerHTML = `<p class="stats-empty">🧮 …</p>`;
    try {
      statsCache = await (await fetch("/api/stats")).json();
      statsCachedAt = Date.now();
    } catch {
      body.innerHTML = `<p class="stats-empty">🌫️</p>`;
      return;
    }
  }
  renderStatsPanel(statsCache);
});

$("stats-close").addEventListener("click", () => ($("stats-overlay").hidden = true));
$("stats-overlay").addEventListener("click", (e) => {
  if (e.target === $("stats-overlay")) $("stats-overlay").hidden = true;
});

function fmtDur(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (d > 0) return `${d} ${t("u_d")} ${h} ${t("u_h")}`;
  if (h > 0) return `${h} ${t("u_h")} ${m} ${t("u_min")}`;
  return `${m} ${t("u_min")}`;
}

function fmtDay(ts) {
  return new Date(ts * 1000).toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

const flagEmoji = (iso2) =>
  iso2 ? String.fromCodePoint(...[...iso2].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🏳️";

function renderStatsPanel(s) {
  const body = $("stats-body");
  if (!s || !s.totalKm) {
    body.innerHTML = `<p class="stats-empty">🌱 …</p>`;
    return;
  }

  const tile = (emoji, value, label, sub) =>
    `<div class="stat-tile"><div class="v">${emoji} ${value}</div><div class="l">${label}</div>${
      sub ? `<div class="s">${sub}</div>` : ""
    }</div>`;

  const tiles = [];
  tiles.push(tile("🛣", `${s.totalKm.toLocaleString(LOCALE)} km`, t("stTotal"), t("stTotalSub", { n: s.movingHours })));
  if (s.longestDrive)
    tiles.push(
      tile("🏁", fmtDur(s.longestDrive.seconds), t("stLongestDrive"),
        `${Math.round(s.longestDrive.km)} km · ${fmtDay(s.longestDrive.startTs)}`)
    );
  if (s.longestStop)
    tiles.push(
      tile("🛌", fmtDur(s.longestStop.seconds), t("stLongestStop"),
        `${s.longestStop.place ? escapeHtml(s.longestStop.place) + " · " : ""}${fmtDay(s.longestStop.startTs)}`)
    );
  /* if (s.topSpeed)
    tiles.push(tile("🚀", `${s.topSpeed.kmh} km/h`, t("stFastest"), fmtDay(s.topSpeed.ts)));
  if (s.avgMovingKmh) tiles.push(tile("🌊", `${s.avgMovingKmh} km/h`, t("stAvg"), t("stAvgSub"))); */
  if (s.topCity)
    tiles.push(tile("🏙", escapeHtml(s.topCity.name), t("stTopCity"), fmtDur(s.topCity.seconds)));
  if (s.highest)
    tiles.push(tile("🏔", `${Math.round(s.highest.ele)} m`, t("stHighest"), fmtDay(s.highest.ts)));
  if (s.hottest)
    tiles.push(tile("🥵", `${Math.round(s.hottest.temp)}°C`, t("stHottest"), fmtDay(s.hottest.ts)));
  if (s.coldest)
    tiles.push(tile("🥶", `${Math.round(s.coldest.temp)}°C`, t("stColdest"), fmtDay(s.coldest.ts)));
  /* if (s.northernmost)
    tiles.push(
      tile("🧭", `${s.northernmost.lat.toFixed(2)}°N`, t("stNorth"), fmtDay(s.northernmost.ts))
    ); */
  tiles.push(
    tile("🏕", `${s.chillDays}`, t("stChill"), t("stChillSub", { n: s.driveDays }))
  );

  let html = `<div class="stat-tiles">${tiles.join("")}</div>`;

  if (s.countries?.length) {
    html += `<p class="stats-section">${t("stCountries")}</p>`;
    html += s.countries
      .map(
        (c) =>
          `<div class="country-row"><span class="flag">${flagEmoji(c.iso2)}</span>
           <span class="cname">${escapeHtml(c.name)}</span>
           <span class="ckm">${c.km.toLocaleString(LOCALE)} km</span>
           <span class="ctime">${fmtDur(c.seconds)}</span></div>`
      )
      .join("");
  }

  body.innerHTML = html;
}

// fly home to wherever the van is right now
$("van-btn").addEventListener("click", () => {
  if (!latestPoints.length) return;
  const last = latestPoints[latestPoints.length - 1];
  map.flyTo([last.lat, last.lon], VAN_ZOOM, { duration: 1.2 });
});

// ---------------------------------------------------------------- loops ---

let cachedPhotos = [];

// stacks huddle and dissolve with zoom
map.on("zoomend", () => {
  if (cachedPhotos.length) renderPhotos(cachedPhotos);
});

async function loadConfig() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    $("trip-name").textContent = cfg.name;
    document.title = `🚐 ${cfg.name}`;
    return cfg;
  } catch {
    $("trip-name").textContent = t("tripFallback");
    return { hasAlbum: false };
  }
}

async function loadPoints() {
  try {
    const data = await (await fetch("/api/points")).json();
    renderPoints(data.points || []);
    renderPhotos(cachedPhotos); // re-match photos against the fresh route
  } catch (err) {
    console.warn("points fetch failed", err);
  }
}

async function loadPhotos() {
  try {
    const data = await (await fetch("/api/photos")).json();
    cachedPhotos = data.photos || [];
    renderPhotos(cachedPhotos);
  } catch (err) {
    console.warn("photos fetch failed", err);
  }
}

(async () => {
  // fire everything at once — photos render as soon as the route is in
  // (harmless no-op response if no album is configured)
  const cfgP = loadConfig();
  const photosP = loadPhotos();
  await loadPoints();
  await photosP;
  const cfg = await cfgP;
  if (cfg.hasAlbum) setInterval(loadPhotos, PHOTOS_EVERY_MS);
  setInterval(loadPoints, POINTS_EVERY_MS);
  // keep "last waved at us" fresh
  setInterval(() => {
    if (latestPoints.length) renderNowCard(latestPoints[latestPoints.length - 1]);
  }, 30_000);
})();
