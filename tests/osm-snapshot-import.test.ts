import test from "node:test";
import assert from "node:assert/strict";
import {
  importOsmSnapshot,
  osmSnapshotAttribution,
  type OsmSnapshotImportSource,
} from "../src/lib/osm-snapshot-import";
import type { SnapshotBusiness, SnapshotPlace } from "../src/lib/osm-snapshot";
import { snapshotReadiness } from "../src/lib/source-readiness";

const source: OsmSnapshotImportSource = {
  sourceName: "OpenStreetMap / Geofabrik",
  sourceUrl: "https://download.geofabrik.de/asia/pakistan-latest.osm.pbf",
  datasetTimestamp: "2026-11-01T00:00:00Z",
};

function place(over: Partial<SnapshotPlace> = {}): SnapshotPlace {
  return {
    id: 100,
    kind: "node",
    name: "Test only Karachi",
    name_en: null,
    place: "city",
    country_code: "Pakistan",
    lat: 24.86,
    lon: 67.01,
    rank: 4,
    ...over,
  };
}

function business(over: Partial<SnapshotBusiness> = {}): SnapshotBusiness {
  return {
    id: 200,
    kind: "node",
    osm_type_id: "node/200",
    category_key: "amenity",
    category_value: "cafe",
    app_category: "cafe",
    name: "Test only Cafe",
    phone: null,
    email: null,
    website: null,
    street: null,
    housenumber: null,
    locality: "Test only Karachi",
    country_code: "Pakistan",
    lat: 24.861,
    lon: 67.011,
    place_ids: [100],
    edit_at: null,
    snapshot_date: "2026-11-01",
    ...over,
  };
}

class SnapshotRpcFixture {
  calls: string[] = [];
  places = new Map<number, SnapshotPlace>();
  businesses = new Map<string, SnapshotBusiness>();
  state: "empty" | "loading" | "ready" | "failed" = "empty";
  metadata: Record<string, unknown> = {};
  failOn: string | null = null;

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push(name);
    if (this.failOn === name)
      return { data: null, error: { message: `intentional ${name} failure` } };
    if (name === "pa_osm_snapshot_begin_import") {
      this.state = "loading";
      this.metadata = {
        source_name: args.p_source_name,
        source_url: args.p_source_url,
        attribution: args.p_attribution,
        dataset_timestamp: args.p_dataset_timestamp,
      };
    } else if (name === "pa_osm_load_places") {
      for (const row of args.p_rows as SnapshotPlace[])
        this.places.set(row.id, row);
    } else if (name === "pa_osm_load_businesses") {
      for (const row of args.p_rows as SnapshotBusiness[])
        this.businesses.set(row.osm_type_id, row);
    } else if (name === "pa_osm_snapshot_complete_import") {
      this.state = "ready";
      this.metadata = {
        ...this.metadata,
        places_imported: args.p_places_imported,
        businesses_imported: args.p_businesses_imported,
        last_successful_import_at: "2026-11-05T12:00:00.000Z",
      };
    } else if (name === "pa_osm_snapshot_fail_import") {
      this.state = "failed";
      this.metadata = { ...this.metadata, last_error: args.p_error };
    } else {
      throw new Error(`Unexpected RPC ${name}`);
    }
    return { data: null, error: null };
  }
}

function snapshot() {
  return { places: [place()], businesses: [business()] };
}

test("empty OSM snapshots are rejected before an import starts", async () => {
  const db = new SnapshotRpcFixture();
  await assert.rejects(
    () =>
      importOsmSnapshot(
        { places: [], businesses: [] },
        source,
        db.rpc.bind(db),
      ),
    /at least one place is required/i,
  );
  assert.deepEqual(db.calls, []);
  assert.equal(db.state, "empty");
});

test("a successful import stores provenance, counts, and ready state", async () => {
  const db = new SnapshotRpcFixture();
  const imported = await importOsmSnapshot(
    snapshot(),
    source,
    db.rpc.bind(db),
    {
      chunkSize: 1,
    },
  );

  assert.deepEqual(imported, {
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    datasetTimestamp: "2026-11-01T00:00:00.000Z",
    placesImported: 1,
    businessesImported: 1,
  });
  assert.equal(db.places.size, 1);
  assert.equal(db.businesses.size, 1);
  assert.equal(db.state, "ready");
  assert.equal(db.metadata.source_name, source.sourceName);
  assert.equal(db.metadata.source_url, source.sourceUrl);
  assert.equal(db.metadata.attribution, osmSnapshotAttribution);
  assert.equal(db.metadata.dataset_timestamp, "2026-11-01T00:00:00.000Z");
  assert.equal(db.metadata.businesses_imported, 1);
  assert.ok(db.metadata.last_successful_import_at);
});

test("repeated snapshot imports upsert the same typed OSM identity without duplicates", async () => {
  const db = new SnapshotRpcFixture();
  await importOsmSnapshot(snapshot(), source, db.rpc.bind(db));
  await importOsmSnapshot(snapshot(), source, db.rpc.bind(db));

  assert.equal(db.places.size, 1);
  assert.equal(db.businesses.size, 1);
  assert.equal(db.businesses.get("node/200")?.name, "Test only Cafe");
  assert.equal(db.state, "ready");
  assert.equal(
    db.calls.filter((call) => call === "pa_osm_snapshot_complete_import")
      .length,
    2,
  );
});

test("duplicate OSM element IDs in one source file are rejected instead of fabricated or merged", async () => {
  const db = new SnapshotRpcFixture();
  await assert.rejects(
    () =>
      importOsmSnapshot(
        {
          places: [place()],
          businesses: [business(), business({ name: "Conflicting test row" })],
        },
        source,
        db.rpc.bind(db),
      ),
    /duplicate OSM element ID node\/200/i,
  );
  assert.deepEqual(db.calls, []);
});

test("invalid source data is rejected before it can write a source record", async () => {
  const db = new SnapshotRpcFixture();
  await assert.rejects(
    () =>
      importOsmSnapshot(
        {
          places: [place()],
          businesses: [business({ lat: 200 })],
        },
        source,
        db.rpc.bind(db),
      ),
    /business has an invalid coordinate/i,
  );
  assert.deepEqual(db.calls, []);
});

test("an import failure marks a partial snapshot unavailable to discovery", async () => {
  const db = new SnapshotRpcFixture();
  db.failOn = "pa_osm_load_businesses";
  await assert.rejects(
    () => importOsmSnapshot(snapshot(), source, db.rpc.bind(db)),
    /pa_osm_load_businesses failed/i,
  );
  assert.equal(db.state, "failed");
  assert.ok(db.calls.includes("pa_osm_snapshot_fail_import"));
  const readiness = snapshotReadiness({
    businesses: db.businesses.size,
    places: db.places.size,
    import_status: db.state,
    last_import_error: db.metadata.last_error,
  });
  assert.equal(readiness.ready, false);
  assert.match(
    readiness.message || "",
    /import is failed.*discovery remains blocked/i,
  );
});
