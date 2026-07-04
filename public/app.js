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
const photoLayer = L.layerGroup().addTo(map);

const vanIcon = L.divIcon({
  className: "van-icon",
  html: '<span class="van-emoji">🚐</span>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});
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
    map.fitBounds(routeLine.getBounds().pad(0.15), { maxZoom: 13 });
    didFitOnce = true;
  } else if (lastPointTs !== null && last.ts !== lastPointTs) {
    map.panTo(lastLL); // gently follow when a fresh point arrives
  }
  lastPointTs = last.ts;

  renderNowCard(last);
  renderStats(points);
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

function renderPhotos(photos) {
  photoLayer.clearLayers();
  photoCount = 0;
  unplacedPhotos = [];

  // Apple strips GPS from public shared albums, so placement works by capture
  // time. A photo taken outside the tracked journey has no honest spot on the
  // route — it goes to the shoebox instead of being pinned somewhere the van
  // merely was later.
  const first = latestPoints[0];
  const last = latestPoints[latestPoints.length - 1];

  const perSpot = new Map(); // spread photos that land on the same point
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

    const key = `${at.lat},${at.lon}`;
    const n = perSpot.get(key) || 0;
    perSpot.set(key, n + 1);
    const angle = (hashish(photo.guid) % 360) * (Math.PI / 180);
    const spread = n * 0.00045;
    const lat = at.lat + Math.sin(angle) * spread;
    const lon = at.lon + Math.cos(angle) * spread;

    const tilt = (hashish(photo.guid) % 13) - 6;
    // a real <img loading="lazy"> means off-screen polaroids don't download
    // their thumbnails until you pan near them
    const icon = L.divIcon({
      className: "photo-marker",
      html: `<img src="${photo.thumb}" loading="lazy" decoding="async" alt="">`,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });

    L.marker([lat, lon], { icon, zIndexOffset: 1000 })
      .bindPopup(() => photoPopupHtml(photo, ts), { maxWidth: 260 })
      .addTo(photoLayer)
      .getElement()
      ?.style.setProperty("--tilt", `${tilt}deg`);
    photoCount++;
  }
  if (latestPoints.length) renderStats(latestPoints);
  renderShoebox();
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

  const grid = $("gallery-grid");
  grid.innerHTML = "";
  for (const photo of [...unplacedPhotos].reverse()) { // newest first
    const img = document.createElement("img");
    img.src = photo.thumb;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = photo.caption || "";
    img.style.transform = `rotate(${(hashish(photo.guid) % 7) - 3}deg)`;
    img.addEventListener("click", () => openLightbox(photo));
    grid.appendChild(img);
  }
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

$("pile-btn").addEventListener("click", () => ($("gallery").hidden = false));
$("gallery-close").addEventListener("click", () => ($("gallery").hidden = true));
$("gallery").addEventListener("click", (e) => {
  if (e.target === $("gallery")) $("gallery").hidden = true;
});
$("lightbox").addEventListener("click", () => ($("lightbox").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("lightbox").hidden = true;
    $("gallery").hidden = true;
  }
});

// re-hug the whole route when someone wanders off across the map
$("recenter-btn").addEventListener("click", () => {
  if (latestPoints.length) map.fitBounds(routeLine.getBounds().pad(0.15), { maxZoom: 13 });
});

// ---------------------------------------------------------------- loops ---

let cachedPhotos = [];

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
  const cfg = await loadConfig();
  await loadPoints();
  if (cfg.hasAlbum) {
    await loadPhotos();
    setInterval(loadPhotos, PHOTOS_EVERY_MS);
  }
  setInterval(loadPoints, POINTS_EVERY_MS);
  // keep "last waved at us" fresh
  setInterval(() => {
    if (latestPoints.length) renderNowCard(latestPoints[latestPoints.length - 1]);
  }, 30_000);
})();
