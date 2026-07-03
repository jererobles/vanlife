#!/usr/bin/env node
// one-command setup: creates the D1 database, wires its id into wrangler.jsonc,
// applies the schema, deploys, and sets a fresh INGEST_TOKEN secret.
//
//   npx wrangler login   (once)
//   npm run setup

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const CONFIG = new URL("../wrangler.jsonc", import.meta.url);

function run(cmd, opts = {}) {
  console.log(`\n✨ ${cmd}`);
  return execSync(cmd, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" });
}

function fail(msg) {
  console.error(`\n💔 ${msg}`);
  process.exit(1);
}

let config = readFileSync(CONFIG, "utf8");

// 1. make sure we have a database id
if (config.includes("REPLACE_ME")) {
  let out = "";
  try {
    out = run("npx wrangler d1 create vanlife", { capture: true });
    console.log(out);
  } catch (err) {
    const text = String(err.stdout || "") + String(err.stderr || "");
    if (!/already exists/i.test(text)) {
      console.error(text);
      fail("could not create the D1 database — are you logged in? (npx wrangler login)");
    }
    console.log("database already exists, looking up its id…");
    out = run("npx wrangler d1 info vanlife", { capture: true });
  }
  const id = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!id) fail("could not find a database id in wrangler's output — paste it into wrangler.jsonc manually");
  config = config.replace('"REPLACE_ME"', `"${id}"`);
  writeFileSync(CONFIG, config);
  console.log(`🌸 saved database_id ${id} to wrangler.jsonc`);
} else {
  console.log("🌸 wrangler.jsonc already has a database_id, skipping create");
}

// 2. schema + deploy
run("npx wrangler d1 execute vanlife --remote --file=schema.sql -y");
run("npx wrangler deploy");

// 3. ingest token (needs the worker to exist, hence after deploy)
const token = randomBytes(24).toString("base64url");
const put = spawnSync("npx", ["wrangler", "secret", "put", "INGEST_TOKEN"], {
  input: token,
  stdio: ["pipe", "inherit", "inherit"],
});
if (put.status !== 0) fail("could not set the INGEST_TOKEN secret — run: npx wrangler secret put INGEST_TOKEN");

console.log(`
🚐💕 all set!

  your ingest token (save it, it's shown only once):

      ${token}

  point Overland / your iOS Shortcut at:

      https://<your-worker-url>/api/ingest?token=${token}

  next cozy steps:
   · put your iCloud shared album token in wrangler.jsonc ("ALBUM_TOKEN") and run: npm run deploy
   · rename the trip via "TRIP_NAME" in wrangler.jsonc
   · re-running setup rotates the ingest token (update your phone if you do)
`);
