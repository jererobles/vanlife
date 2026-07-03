// vanlife map 🚐💕
// fetches /api/points + /api/photos, draws a pastel route with photo polaroids

const POINTS_EVERY_MS = 60_000;
const PHOTOS_EVERY_MS = 10 * 60_000;
const PHOTO_MATCH_WINDOW_S = 12 * 3600; // photo must be within 12h of a track point

// WMO weather codes -> cozy emoji + words
const WEATHER = [
  [[0], "☀️", "sunny"],
  [[1], "🌤️", "mostly sunny"],
  [[2], "⛅", "partly cloudy"],
  [[3], "☁️", "cloudy"],
  [[45, 48], "🌫️", "foggy"],
  [[51, 53, 55, 56, 57], "🌦️", "drizzly"],
  [[61, 63, 65, 66, 67], "🌧️", "rainy"],
  [[71, 73, 75, 77], "❄️", "snowy"],
  [[80, 81, 82], "🌧️", "showers"],
  [[85, 86], "🌨️", "snow showers"],
  [[95, 96, 99], "⛈️", "stormy"],
];

function weatherLook(code) {
  if (code == null) return ["✨", "adventuring"];
  for (const [codes, emoji, word] of WEATHER) if (codes.includes(code)) return [emoji, word];
  return ["🌈", "mystery weather"];
}

// ------------------------------------------------------------------ map ---

const map = L.map("map", { zoomControl: false, attributionControl: true });
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 20,
}).addTo(map);
map.setView([54, 10], 4); // placeholder view until points arrive

const routeCasing = L.polyline([], { color: "#ffffff", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round" }).addTo(map);
const routeLine = L.polyline([], { color: "#f4a9c7", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
const dotsLayer = L.layerGroup().addTo(map);
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
  return new Date(ts * 1000).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function timeAgo(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
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

  // little dots you can poke for time/weather — decimated so the map stays snappy
  dotsLayer.clearLayers();
  const step = Math.max(1, Math.ceil(points.length / 300));
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const [emoji] = weatherLook(p.wcode);
    const bits = [fmtTime(p.ts)];
    if (p.temp != null) bits.push(`${Math.round(p.temp)}°C ${emoji}`);
    if (p.ele != null) bits.push(`⛰ ${Math.round(p.ele)} m`);
    L.circleMarker([p.lat, p.lon], {
      radius: 4.5, color: "#fff", weight: 2, fillColor: "#cbb7f0", fillOpacity: 1,
    })
      .bindPopup(
        `<div class="point-pop"><p class="head">🐾 along the way</p><p class="meta">${bits.join(" · ")}</p></div>`
      )
      .addTo(dotsLayer);
  });

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

function renderNowCard(p) {
  const [emoji, word] = weatherLook(p.wcode);
  $("now-emoji").textContent = emoji;
  $("now-temp").textContent = p.temp != null ? `${Math.round(p.temp)}°C` : "—";
  $("now-desc").textContent = word;

  const chips = [];
  if (p.ele != null) chips.push(`⛰ ${Math.round(p.ele)} m`);
  if (p.wind != null) chips.push(`🍃 ${Math.round(p.wind)} km/h`);
  if (p.hum != null) chips.push(`💧 ${Math.round(p.hum)}%`);
  if (p.feels != null) chips.push(`🤗 feels ${Math.round(p.feels)}°`);
  if (p.speed != null && p.speed > 2) chips.push(`🛞 cruising ${Math.round(p.speed)} km/h`);
  if (p.batt != null) chips.push(`🔋 ${Math.round(p.batt)}%`);
  $("now-chips").innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join("");

  $("now-updated").textContent = `last waved at us ${timeAgo(p.ts)} 💌`;
  $("now-card").hidden = false;
}

function renderStats(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  const days = Math.floor((points[points.length - 1].ts - points[0].ts) / 86400) + 1;
  const parts = [
    `🛣 ${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1)} km`,
    `🏕 day ${days}`,
  ];
  if (photoCount > 0) parts.push(`📸 ${photoCount} photos`);
  $("stats").innerHTML = parts.map((s) => `<span>${s}</span>`).join("");
}

let photoCount = 0;

function renderPhotos(photos) {
  photoLayer.clearLayers();
  photoCount = 0;

  const perSpot = new Map(); // spread photos that land on the same point
  for (const photo of photos) {
    if (!photo.takenAt || !photo.thumb) continue;
    const ts = Math.floor(Date.parse(photo.takenAt) / 1000);
    const at = nearestPoint(latestPoints, ts);
    if (!at) continue;

    const key = `${at.lat},${at.lon}`;
    const n = perSpot.get(key) || 0;
    perSpot.set(key, n + 1);
    const angle = (hashish(photo.guid) % 360) * (Math.PI / 180);
    const spread = n * 0.00045;
    const lat = at.lat + Math.sin(angle) * spread;
    const lon = at.lon + Math.cos(angle) * spread;

    const tilt = (hashish(photo.guid) % 13) - 6;
    const icon = L.divIcon({
      className: "photo-marker",
      html: `<div style="width:100%;height:100%;border-radius:11px;background-image:url('${photo.thumb}');background-size:cover;background-position:center"></div>`,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });

    const meta = [];
    if (photo.by) meta.push(`by ${photo.by}`);
    meta.push(fmtTime(ts));
    L.marker([lat, lon], { icon, zIndexOffset: 1000 })
      .bindPopup(
        `<div class="photo-pop">
           <img src="${photo.url}" alt="">
           ${photo.caption ? `<p class="cap">${escapeHtml(photo.caption)}</p>` : ""}
           <p class="meta">📸 ${meta.map(escapeHtml).join(" · ")}</p>
         </div>`,
        { maxWidth: 260 }
      )
      .addTo(photoLayer)
      .getElement()
      ?.style.setProperty("--tilt", `${tilt}deg`);
    photoCount++;
  }
  if (latestPoints.length) renderStats(latestPoints);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------------------------------------------------------------- loops ---

let cachedPhotos = [];

async function loadConfig() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    $("trip-name").textContent = cfg.name;
    document.title = `🚐 ${cfg.name}`;
    return cfg;
  } catch {
    $("trip-name").textContent = "our little adventure";
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
