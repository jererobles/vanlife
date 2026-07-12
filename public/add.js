// 🧵 stitch the route — tap the map where the tracker was napping and those
// spots become retroactive route points (via /api/backfill, which also looks
// up the weather that was really happening at that time and place).

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ map ---

const map = L.map("map", { zoomControl: false });
L.control.zoom({ position: "bottomright" }).addTo(map);

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

map.setView([54, 10], 4); // placeholder view until the route arrives

const routeCasing = L.polyline([], { color: "#ffffff", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: "#f4a9c7", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
// dotted preview of how the route would flow once the new points are in
const previewLine = L.polyline([], { color: "#cbb7f0", weight: 4, opacity: 0.9, dashArray: "1 10", lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);

let route = [];
let didFitOnce = false;

async function loadRoute() {
  try {
    const data = await (await fetch("/api/points")).json();
    route = data.points || [];
    const latlngs = route.map((p) => [p.lat, p.lon]);
    routeCasing.setLatLngs(latlngs);
    routeLine.setLatLngs(latlngs);
    if (route.length && !didFitOnce) {
      map.fitBounds(routeLine.getBounds().pad(0.15), { maxZoom: 13 });
      didFitOnce = true;
    }
    refresh();
  } catch {
    $("result").textContent = t("loadFail");
  }
}

// ------------------------------------------------------- time guessing ---
// a tapped spot probably belongs between the two route points whose segment
// it lies closest to, so interpolate the timestamp along that segment.
// flat-ish degree space (lon scaled by cos lat) is plenty for snapping.

function guessTs(ll) {
  const now = Math.floor(Date.now() / 1000);
  if (route.length < 2) return freeMinute(route.length ? route[0].ts : now);

  const cos = Math.cos((ll.lat * Math.PI) / 180);
  let best = Infinity, bestTs = now;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const ax = (a.lon - ll.lng) * cos, ay = a.lat - ll.lat;
    const dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
    const len2 = dx * dx + dy * dy;
    const f = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + f * dx, py = ay + f * dy;
    const d = px * px + py * py;
    if (d < best) {
      best = d;
      bestTs = Math.round(a.ts + f * (b.ts - a.ts));
    }
  }
  return freeMinute(bestTs);
}

// the inputs are minute-grained and the db dedupes on ts, so nudge the guess
// to the nearest minute nobody is using yet (and never into the future)
function freeMinute(ts) {
  const now = Math.floor(Date.now() / 1000);
  const used = new Set(route.map((p) => p.ts - (p.ts % 60)));
  for (const p of pending) {
    const t = p.getTs();
    if (t) used.add(t - (t % 60));
  }
  const start = Math.min(ts - (ts % 60), now - (now % 60));
  for (let k = 0; k < 10080; k++) {
    for (const cand of k ? [start - k * 60, start + k * 60] : [start]) {
      if (cand > 946684800 && cand <= now && !used.has(cand)) return cand;
    }
  }
  return start;
}

function tsToInput(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function inputToTs(value) {
  const ms = new Date(value).getTime(); // datetime-local is wall clock, parsed local
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// -------------------------------------------------------- pending points ---

const pending = []; // {id, marker, row, input, getTs, touched}
let seq = 0;

map.on("click", (e) => addPoint(e.latlng));

function addPoint(ll) {
  const id = ++seq;
  const icon = L.divIcon({
    className: "new-pt",
    html: `<span>${id}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  const marker = L.marker(ll, { icon, draggable: true, zIndexOffset: 2000 }).addTo(map);

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="idx">${id}</span>
    <input type="datetime-local" min="2000-01-01T00:00" title="${t("whenHere")}" aria-label="${t("whenHere")}">
    <button class="x" title="${t("removePoint")}" aria-label="${t("removePoint")}">✕</button>
    <span class="where"></span>`;
  $("rows").appendChild(row);

  const input = row.querySelector("input");
  const p = { id, marker, row, input, touched: false, getTs: () => inputToTs(input.value) };
  pending.push(p);

  input.value = tsToInput(guessTs(ll));
  updateWhere(p);

  input.addEventListener("change", () => {
    p.touched = true;
    refresh();
  });
  row.querySelector(".x").addEventListener("click", () => removePoint(p));
  marker.on("dragend", () => {
    // a moved marker gets a fresh guess, unless a hand-picked time is set
    if (!p.touched) input.value = tsToInput(guessTs(marker.getLatLng()));
    updateWhere(p);
    refresh();
  });
  marker.on("click", () => row.scrollIntoView({ block: "nearest", behavior: "smooth" }));

  refresh();
}

function removePoint(p) {
  map.removeLayer(p.marker);
  p.row.remove();
  pending.splice(pending.indexOf(p), 1);
  refresh();
}

function updateWhere(p) {
  const ll = p.marker.getLatLng();
  p.row.querySelector(".where").textContent = `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
}

function refresh() {
  $("hint").textContent = pending.length ? tn("newPoints", pending.length) : t("addHint");
  $("save-btn").disabled = !pending.length;

  const merged = [
    ...route.map((p) => ({ lat: p.lat, lon: p.lon, ts: p.ts })),
    ...pending
      .map((p) => {
        const ll = p.marker.getLatLng();
        return { lat: ll.lat, lon: ll.lng, ts: p.getTs() };
      })
      .filter((p) => p.ts),
  ].sort((a, b) => a.ts - b.ts);
  previewLine.setLatLngs(pending.length && merged.length > 1 ? merged.map((p) => [p.lat, p.lon]) : []);
}

// --------------------------------------------------------------- submit ---

$("token").value = localStorage.getItem("vanlife-token") || "";

$("save-btn").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!token) return ($("result").textContent = t("needToken"));

  const now = Math.floor(Date.now() / 1000);
  for (const p of pending) {
    const ts = p.getTs();
    if (!ts || ts <= 946684800) return ($("result").textContent = t("needTime"));
    if (ts > now + 300) return ($("result").textContent = t("futureTime"));
  }
  localStorage.setItem("vanlife-token", token);

  const entries = [...pending].sort((a, b) => a.getTs() - b.getTs());
  const btn = $("save-btn");
  btn.disabled = true;
  let stored = 0, duplicates = 0, failed = 0;
  for (let i = 0; i < entries.length; i += 15) {
    $("result").textContent = t("travelling", { i, n: entries.length });
    const batch = entries.slice(i, i + 15);
    try {
      const res = await fetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          points: batch.map((p) => {
            const ll = p.marker.getLatLng();
            return { lat: ll.lat, lon: ll.lng, ts: p.getTs() };
          }),
        }),
      });
      if (res.status === 401) {
        $("result").textContent = t("badToken");
        btn.disabled = !pending.length;
        return;
      }
      const data = await res.json();
      stored += data.stored || 0;
      duplicates += data.duplicates || 0;
      batch.forEach(removePoint); // saved points leave the list...
    } catch {
      failed++; // ...failed batches stay, so nothing is lost
    }
  }
  btn.disabled = !pending.length;
  $("result").textContent =
    tn("added", stored) +
    (duplicates ? t("dupes", { n: duplicates }) : "") +
    (failed ? t("failedBatches", { n: failed }) : "") +
    (stored ? t("seeMap") : "");
  loadRoute(); // the fresh points join the solid pink line
});

loadRoute();
