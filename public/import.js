// 🧳 the time machine — read GPS + capture time from photos, in the browser,
// and backfill them as route points. No image data ever leaves the device.

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ tiny EXIF ---
// Just enough EXIF: capture time + GPS. JPEG via the APP1 segment; HEIC and
// friends via a scan for the "Exif\0\0" marker (the payload is stored intact
// inside the container, so this finds it without parsing ISO-BMFF boxes).

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

async function readExif(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const t = findTiff(b);
  if (t < 0) return null;
  try {
    return parseTiff(b, t);
  } catch {
    return null;
  }
}

function findTiff(b) {
  if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segment list looking for APP1/Exif
    let o = 2;
    while (o + 4 < b.length && b[o] === 0xff) {
      const marker = b[o + 1];
      const size = (b[o + 2] << 8) | b[o + 3];
      if (marker === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78) return o + 10;
      if (marker === 0xda) break; // image data starts, no Exif before it
      o += 2 + size;
    }
    return -1;
  }
  // HEIC etc: scan for Exif\0\0 followed by a TIFF byte-order mark
  const limit = Math.min(b.length - 10, 8 * 1024 * 1024);
  for (let i = 0; i < limit; i++) {
    if (
      b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 &&
      b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0
    ) {
      const t = i + 6;
      const bo = (b[t] << 8) | b[t + 1];
      if (bo === 0x4949 || bo === 0x4d4d) return t;
    }
  }
  return -1;
}

function parseTiff(b, t) {
  const dv = new DataView(b.buffer, b.byteOffset);
  const le = b[t] === 0x49;
  const u16 = (o) => dv.getUint16(t + o, le);
  const u32 = (o) => dv.getUint32(t + o, le);
  if (u16(2) !== 42) return null;

  const valOffset = (e) => {
    const size = (TYPE_SIZE[u16(e + 2)] || 1) * u32(e + 4);
    return size <= 4 ? e + 8 : u32(e + 8);
  };
  const ascii = (e) => {
    const o = valOffset(e), n = u32(e + 4);
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = b[t + o + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const rationals = (e) => {
    const o = valOffset(e), n = u32(e + 4), out = [];
    for (let i = 0; i < n; i++) out.push(u32(o + i * 8) / (u32(o + i * 8 + 4) || 1));
    return out;
  };
  const readIfd = (off, handlers) => {
    if (!off || t + off + 2 > b.length) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      handlers[u16(e)]?.(e);
    }
  };

  const x = {};
  readIfd(u32(4), {
    0x8769: (e) => (x.exifIfd = u32(e + 8)),
    0x8825: (e) => (x.gpsIfd = u32(e + 8)),
    0x0132: (e) => (x.dateTime = ascii(e)),
  });
  readIfd(x.exifIfd, {
    0x9003: (e) => (x.dtOriginal = ascii(e)),
    0x9011: (e) => (x.tzOffset = ascii(e)),
  });
  readIfd(x.gpsIfd, {
    0x0001: (e) => (x.latRef = ascii(e)),
    0x0002: (e) => (x.lat = rationals(e)),
    0x0003: (e) => (x.lonRef = ascii(e)),
    0x0004: (e) => (x.lon = rationals(e)),
    0x0005: (e) => (x.altRef = b[t + valOffset(e)]),
    0x0006: (e) => (x.alt = rationals(e)[0]),
    0x0007: (e) => (x.gpsTime = rationals(e)),
    0x001d: (e) => (x.gpsDate = ascii(e)),
  });

  if (!x.lat || !x.lon || x.lat.length < 3 || x.lon.length < 3) return null;
  const dms = (r) => r[0] + r[1] / 60 + r[2] / 3600;
  const lat = dms(x.lat) * (x.latRef === "S" ? -1 : 1);
  const lon = dms(x.lon) * (x.lonRef === "W" ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;

  return {
    lat,
    lon,
    altitude: Number.isFinite(x.alt) ? x.alt * (x.altRef === 1 ? -1 : 1) : null,
    ts: bestTimestamp(x),
  };
}

function bestTimestamp(x) {
  const exifDate = x.dtOriginal || x.dateTime; // "YYYY:MM:DD HH:MM:SS"
  // wall clock + explicit timezone (iOS writes OffsetTimeOriginal) is best
  if (exifDate && /^[+-]\d\d:\d\d$/.test(x.tzOffset || "")) {
    const iso = exifDate.replace(/^(\d{4}):(\d\d):(\d\d) /, "$1-$2-$3T") + x.tzOffset;
    const ms = Date.parse(iso);
    if (ms) return Math.floor(ms / 1000);
  }
  // GPS date+time is UTC, no timezone guessing needed
  if (x.gpsDate && x.gpsTime?.length === 3) {
    const [h, m, s] = x.gpsTime;
    const iso = `${x.gpsDate.replace(/:/g, "-")}T${pad(h)}:${pad(m)}:${pad(Math.floor(s))}Z`;
    const ms = Date.parse(iso);
    if (ms) return Math.floor(ms / 1000);
  }
  // last resort: interpret the wall clock in this browser's timezone
  if (exifDate) {
    const m = exifDate.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (m) return Math.floor(new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6]).getTime() / 1000);
  }
  return null;
}

const pad = (n) => String(Math.floor(n)).padStart(2, "0");

// ------------------------------------------------------------------ page ---

const parsed = []; // {name, point|null}

const drop = $("drop");
drop.addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => addFiles(e.target.files));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles(e.dataTransfer.files);
});

async function addFiles(fileList) {
  for (const file of fileList) {
    const exif = await readExif(file).catch(() => null);
    const ok = exif && exif.ts;
    parsed.push({ name: file.name, point: ok ? exif : null });
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = ok
      ? `<span>🌍</span><span class="name"></span>
         <span class="where">${exif.lat.toFixed(4)}, ${exif.lon.toFixed(4)} · ${new Date(exif.ts * 1000).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>`
      : `<span>🫥</span><span class="name"></span><span class="where">${t("noGps")}</span>`;
    row.querySelector(".name").textContent = file.name;
    $("rows").appendChild(row);
  }
  $("action").hidden = parsed.every((p) => !p.point);
  $("result").textContent = "";
}

$("token").value = localStorage.getItem("vanlife-token") || "";

$("import-btn").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!token) return ($("result").textContent = t("needToken"));
  localStorage.setItem("vanlife-token", token);

  // sort by time and thin out near-duplicates (burst shots etc.)
  const points = parsed
    .map((p) => p.point)
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)
    .filter((p, i, arr) => i === 0 || p.ts - arr[i - 1].ts >= 60);

  const btn = $("import-btn");
  btn.disabled = true;
  let stored = 0, duplicates = 0, failed = 0;
  for (let i = 0; i < points.length; i += 15) {
    $("result").textContent = t("travelling", { i, n: points.length });
    try {
      const res = await fetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ points: points.slice(i, i + 15) }),
      });
      if (res.status === 401) {
        $("result").textContent = t("badToken");
        btn.disabled = false;
        return;
      }
      const data = await res.json();
      stored += data.stored || 0;
      duplicates += data.duplicates || 0;
    } catch {
      failed++;
    }
  }
  btn.disabled = false;
  $("result").textContent =
    tn("added", stored) +
    (duplicates ? t("dupes", { n: duplicates }) : "") +
    (failed ? t("failedBatches", { n: failed }) : "") +
    t("seeMap");
});
