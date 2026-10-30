import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  discoverOsmSnapshot,
  type SnapshotRpc,
} from "../src/lib/discovery-core";
import { fingerprint, type SearchInput } from "../src/lib/discovery";
import { createWorkerHandler } from "../supabase/functions/prospectai-worker/index";

const input: SearchInput = {
  country: "Pakistan",
  city: "Karachi",
  category: "cafe",
  keywords: "",
  service_area: "",
  max_results: 25,
  requirements: { public_contact: false, website_review: false },
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1234,
    osm_type_id: "node/1234",
    name: "Cafe Rio",
    phone: null,
    email: null,
    website: "caferio.example",
    street: "I.I. Chundrigar Road",
    housenumber: "4",
    locality: "Karachi",
    lat: 24.86,
    lon: 67.01,
    edit_at: null,
    snapshot_date: "2026-10-30",
    distance_km: 1.2,
    ...over,
  };
}

function rpc(rows: unknown[]): SnapshotRpc {
  return async (name, args) => {
    assert.equal(name, "pa_osm_search");
    assert.deepEqual(args, {
      p_country: "Pakistan",
      p_city: "Karachi",
      p_category: "cafe",
      p_limit: 100,
    });
    return { data: rows, error: null };
  };
}

test("snapshot rows map to the same source shape with attribution", async () => {
  const rows = await discoverOsmSnapshot(input, rpc([row()]));
  assert.equal(rows.length, 1);
  const business = rows[0];
  assert.equal(business.provider, "openstreetmap");
  assert.equal(business.source_id, "node/1234");
  assert.equal(business.website, "https://caferio.example");
  assert.equal(
    business.facts.attribution,
    "© OpenStreetMap contributors, ODbL",
  );
  assert.equal(business.facts.source_format, "OpenStreetMap snapshot dated 2026-10-30");
  assert.equal(business.facts.distance_km, 1.2);
  assert.match(String(business.facts.activity_note), /not evidence of current/);
});

test("snapshot fingerprint matches the worker hash so duplicates still bind", async () => {
  const [business] = await discoverOsmSnapshot(input, rpc([row()]));
  const expected = fingerprint(
    "Cafe Rio",
    "Karachi|Pakistan|I.I. Chundrigar Road 4",
  );
  assert.equal(business.fingerprint, expected);
});

test("an unknown city fails loudly instead of reporting an empty success", async () => {
  await assert.rejects(
    () => discoverOsmSnapshot(input, rpc([])),
    /no cafe listing for Karachi.*no results were fabricated/i,
  );
});

test("snapshot filters can legitimately empty a search and are reported as failures", async () => {
  const contactOnly: SearchInput = {
    ...input,
    requirements: { public_contact: true, website_review: false },
  };
  await assert.rejects(
    () => discoverOsmSnapshot(contactOnly, rpc([row(), row({ id: 9 })])),
    /Reviewed 2 cafe snapshot listings.*Reported as failed/i,
  );
  const keywords = { ...input, keywords: "pizza" };
  await assert.rejects(() => discoverOsmSnapshot(keywords, rpc([row()])));
});

test("snapshot results respect the requested maximum", async () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    row({ id: 100 + i, osm_type_id: `node/${100 + i}`, name: `Cafe ${i}` }),
  );
  const rows = await discoverOsmSnapshot(
    { ...input, max_results: 3 },
    rpc(many),
  );
  assert.equal(rows.length, 3);
});

test("a malformed snapshot row is rejected rather than trusted", async () => {
  await assert.rejects(
    () => discoverOsmSnapshot(input, rpc([{ ...row(), name: 42 }])),
    /Invalid snapshot/i,
  );
  await assert.rejects(
    () => discoverOsmSnapshot(input, rpc([{ ...row(), lat: "north" }])),
    /Invalid snapshot coordinate/i,
  );
});

const secret = "test-only-" + "x".repeat(64);
const jobId = randomUUID();
const lease = randomUUID();

test("the cloud worker uses the snapshot with no endpoint and no network fetch", async () => {
  const calls: string[] = [];
  const env = {
    get(name: string) {
      const values: Record<string, string> = {
        PA_WORKER_TOKEN: secret,
        PA_OSM_SNAPSHOT: "1",
      };
      return values[name];
    },
  };
  const database = () => ({
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push(name);
      if (name === "pa_cloud_claim")
        return {
          data: {
            token: lease,
            job: {
              id: jobId,
              provider: "openstreetmap",
              country: "Pakistan",
              city: "Karachi",
              category: "cafe",
              max_results: 25,
              requirements: { public_contact: false, website_review: false },
            },
          },
          error: null,
        };
      if (name === "pa_osm_search") {
        assert.ok(args);
        return { data: [row()], error: null };
      }
      return { data: { stored: 1 }, error: null };
    },
  });
  const globalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("The snapshot path must not reach the network.");
  };
  try {
    const response = await createWorkerHandler({ env, database })(
      new Request("https://example.invalid/worker", {
        method: "POST",
        headers: { "x-worker-token": secret },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      result: { stored: 1 },
      mode: "listing-only",
    });
  } finally {
    globalThis.fetch = globalFetch;
  }
  assert.deepEqual(calls, ["pa_cloud_claim", "pa_osm_search", "pa_cloud_commit"]);
});

test("the cloud worker still refuses to run with no source configured", async () => {
  const handler = createWorkerHandler({
    env: { get: (name) => (name === "PA_WORKER_TOKEN" ? secret : undefined) },
    database: () => ({
      async rpc() {
        return { data: null, error: null };
      },
    }),
  });
  const response = await handler(
    new Request("https://example.invalid/worker", {
      method: "POST",
      headers: { "x-worker-token": secret },
    }),
  );
  assert.equal(response.status, 503);
});
