# 🚐💕 vanlife — a cozy live adventure tracker

A little pastel map that shows where the van is, the route so far, the weather
and elevation along the way, and photos from a shared iCloud album pinned to
the spots where they were taken. Share the link with anyone you love.

Everything runs on **one Cloudflare Worker** (free tier friendly):
static map UI + JSON API + D1 (SQLite) storage. Weather & elevation come from
[Open-Meteo](https://open-meteo.com) — no API key needed.

## quickstart

```bash
npm install
npx wrangler login   # once
npm run setup        # creates the D1 db, deploys, prints your ingest token
```

That's it — setup prints your live URL and a secret **ingest token**.

Day-to-day:

```bash
npm run dev      # local dev at http://localhost:8787 (live-reloads the UI)
npm run seed     # fill local dev with a cute fake alpine road trip
npm run deploy   # ship it
```

### deploy on git push (optional)

Add two repo secrets in GitHub → Settings → Secrets → Actions:

- `CLOUDFLARE_API_TOKEN` — an API token with the *Edit Cloudflare Workers* + *D1 Edit* permissions
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar

Every push to `main` then deploys automatically via `.github/workflows/deploy.yml`.

## sending the van's location 📍

The worker accepts points at `POST /api/ingest`, authorized by your ingest
token (either `Authorization: Bearer <token>` or `?token=<token>`).

### option A — Overland (recommended, set & forget)

[Overland](https://overland.p3k.app) is a free open-source iOS app that logs
GPS in the background and batches it to any endpoint — perfect over a 5G modem.

1. Install Overland on the iPhone/iPad that lives in the van
2. Settings → Receiver Endpoint URL:
   `https://<your-worker-url>/api/ingest?token=<INGEST_TOKEN>`
3. Choose a relaxed logging mode to be gentle on battery/data

Overland sends altitude, speed and battery too — they all show up on the map.
Points closer than `MIN_GAP_SECONDS` (default 120 s) apart are skipped, so you
can log aggressively without bloating the map.

### option B — iOS Shortcut (no app)

Make a Shortcut (optionally run by an Automation, e.g. hourly or on CarPlay connect):

1. **Get current location**
2. **Get contents of URL**
   - URL: `https://<your-worker-url>/api/ingest?token=<INGEST_TOKEN>`
   - Method `POST`, Request Body `JSON`:
     `lat` → Current Location Latitude, `lon` → Current Location Longitude,
     `altitude` → Current Location Altitude

Weather (temp, feels-like, humidity, wind, sky) and elevation are attached
server-side to each point automatically.

## photos from an iCloud shared album 📸

1. On iPhone: create a Shared Album, add your partner, and enable
   **Public Website** in the album's settings
2. Copy the link — it looks like `https://www.icloud.com/sharedalbum/#B0abcdEFGhijKLM`
3. Put the part after `#` into `ALBUM_TOKEN` in `wrangler.jsonc`, then `npm run deploy`

Photos are matched to the route by the time they were taken (nearest track
point within 12 h) and appear as tilted little polaroids on the map. Add a
caption in the album and it shows in the popup, in cute handwriting. New
photos appear within ~10 minutes (the album feed is cached). Videos are
skipped for now.

## making it yours 💅

- `TRIP_NAME` in `wrangler.jsonc` — the handwritten title on the map
- pastel palette lives in `public/style.css` (`:root` variables)
- fonts: Quicksand + Gochi Hand, swap them in `public/index.html`

## API

| route | what |
| --- | --- |
| `POST /api/ingest` | store points — Overland batches or `{lat, lon, ts?, altitude?, speed_kmh?, battery?}` |
| `GET /api/points?limit=&since=` | route history, oldest → newest |
| `GET /api/photos` | shared-album photos with signed URLs (cached ~10 min) |
| `GET /api/config` | trip name + whether an album is configured |

The map is public by design — anyone with the link can see it. Only ingesting
requires the token. If you ever want to pause sharing, rotate the token and
stop deploying, or put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
in front of the worker.
