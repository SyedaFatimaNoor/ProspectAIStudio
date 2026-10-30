// Builds an OpenStreetMap snapshot from a country .osm.pbf and optionally loads
// it into the workspace database. Runs locally only: the extract is a large file
// and the service-role key stays on this machine.
import nextEnv from "@next/env";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { buildOsmSnapshot } from "../src/lib/osm-snapshot";
import { extractPathConfigured } from "../src/lib/discovery";

nextEnv.loadEnvConfig(process.cwd());

const arg = (name: string, fallback = "") =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(`--${name}=`.length) ?? fallback;

const filePath = arg("file") || extractPathConfigured();
if (!filePath) {
  console.error(
    "No extract path. Set OSM_EXTRACT_PATH or pass --file=<country>.osm.pbf. Nothing was built.",
  );
  process.exit(1);
}
const countryCode = arg("country", "Pakistan");
if (!existsSync(filePath)) {
  console.error(
    `Extract not found at ${filePath}. Download it from download.geofabrik.de first. Nothing was built.`,
  );
  process.exit(1);
}
const snapshotDate = new Date().toISOString().slice(0, 10);
const outFile = arg("out", `.osm-cache/snapshot-${countryCode.toLowerCase()}.json`);
const chunkSize = Number(arg("chunk", "2000"));

console.log(`Parsing ${filePath} (two passes over the full extract).`);
const started = Date.now();
const { places, businesses } = await buildOsmSnapshot(filePath, {
  countryCode,
  snapshotDate,
});
console.log(
  `Built ${places.length} places and ${businesses.length} listings in ${Math.round(
    (Date.now() - started) / 1000,
  )}s.`,
);
const withContact = businesses.filter((b) => b.phone || b.email).length;
const withWebsite = businesses.filter((b) => b.website).length;
console.log(`  with public contact: ${withContact}, with website: ${withWebsite}`);
await writeFile(
  outFile,
  JSON.stringify({ places, businesses }, null, 0),
  "utf8",
);
console.log(`Wrote ${outFile}.`);

if (!process.argv.includes("--load")) {
  console.log(
    "Dry run only. Nothing was sent to the database. Re-run with --load to store the snapshot.",
  );
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Loading requires NEXT_PUBLIC_SUPABASE_URL and the server-only service role key.",
  );
  process.exit(1);
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function load(functionName: string, rows: unknown[]) {
  let stored = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await db.rpc(functionName, { p_rows: chunk });
    if (error) throw new Error(`${functionName} chunk ${i}: ${error.message}`);
    stored += chunk.length;
    console.log(`  ${functionName}: ${stored}/${rows.length}`);
  }
}
console.log("Loading into the workspace database (upsert, no deletions).");
await load("pa_osm_load_places", places);
await load("pa_osm_load_businesses", businesses);
console.log("Snapshot loaded.");
