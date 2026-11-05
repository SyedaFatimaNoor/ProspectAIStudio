// Builds an OpenStreetMap snapshot from a country .osm.pbf and optionally loads
// it into the workspace database. Runs locally only: the extract is a large file
// and the service-role key stays on this machine.
import nextEnv from "@next/env";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  importOsmSnapshot,
  osmSnapshotAttribution,
} from "../src/lib/osm-snapshot-import";
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

const suppliedDatasetTimestamp = arg("dataset-timestamp") || null;
if (
  suppliedDatasetTimestamp &&
  Number.isNaN(new Date(suppliedDatasetTimestamp).getTime())
) {
  console.error(
    "--dataset-timestamp must be an ISO-8601 timestamp when the extract publication time is known.",
  );
  process.exit(1);
}
const snapshotDate = suppliedDatasetTimestamp
  ? new Date(suppliedDatasetTimestamp).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);
const outFile = arg(
  "out",
  `.osm-cache/snapshot-${countryCode.toLowerCase()}.json`,
);
const chunkSize = Number(arg("chunk", "2000"));
const sourceName = arg("source-name", "OpenStreetMap");
const sourceUrl = arg("source-url");

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
console.log(
  `  with public contact: ${withContact}, with website: ${withWebsite}`,
);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      source_name: sourceName,
      source_url: sourceUrl || null,
      attribution: osmSnapshotAttribution,
      dataset_timestamp: suppliedDatasetTimestamp,
      snapshot_record_date: snapshotDate,
      places,
      businesses,
    },
    null,
    0,
  ),
  "utf8",
);
console.log(`Wrote ${outFile}.`);

if (!process.argv.includes("--load")) {
  console.log(
    "Dry run only. Nothing was sent to the database. Re-run with --load and the exact HTTPS --source-url to store the snapshot.",
  );
  process.exit(0);
}

if (!sourceUrl) {
  console.error(
    "Loading requires --source-url=<exact HTTPS URL for the downloaded extract> so provenance can be stored. Nothing was loaded.",
  );
  process.exit(1);
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

try {
  const loaded = await importOsmSnapshot(
    { places, businesses },
    {
      sourceName,
      sourceUrl,
      datasetTimestamp: suppliedDatasetTimestamp,
    },
    (name, args) => db.rpc(name, args),
    {
      chunkSize,
      onProgress(operation, completed, total) {
        console.log(`  ${operation}: ${completed}/${total}`);
      },
    },
  );
  console.log(
    `Snapshot import succeeded: ${loaded.placesImported} places and ${loaded.businessesImported} businesses. The snapshot is now ready for its configured worker path.`,
  );
} catch (cause) {
  console.error(
    `Snapshot import failed. The source remains blocked until a complete import succeeds: ${cause instanceof Error ? cause.message : "Unknown import failure"}`,
  );
  process.exitCode = 1;
}
