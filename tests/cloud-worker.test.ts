import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createWorkerHandler,
  validWorkerToken,
} from "../supabase/functions/prospectai-worker/index";

const secret = "test-only-" + "x".repeat(64);
const env = {
  get(name: string) {
    const values: Record<string, string> = {
      PA_WORKER_TOKEN: secret,
      PA_OVERPASS_URL: "https://overpass-api.de/api/interpreter",
    };
    return values[name];
  },
};
const job = {
  id: randomUUID(),
  provider: "openstreetmap",
  country: "Pakistan",
  city: "Karachi",
  category: "dentist",
  max_results: 25,
  requirements: { public_contact: false, website_review: true },
};
const token = randomUUID();
function request(tokenValue: string | null = secret, body = "{}") {
  return new Request("https://example.invalid/worker", {
    method: "POST",
    headers: tokenValue ? { "x-worker-token": tokenValue } : {},
    body,
  });
}

test("cloud worker uses constant-time comparison and rejects missing, short and wrong tokens", async () => {
  assert.equal(await validWorkerToken(secret, secret), true);
  for (const value of [null, "", "wrong", secret + "x", "x".repeat(1000)])
    assert.equal(await validWorkerToken(secret, value), false);
  assert.equal(await validWorkerToken("short", "short"), false);
});

test("cloud worker rejects unauthorized callers before any database/provider access", async () => {
  let accesses = 0;
  const handler = createWorkerHandler({
    env,
    database() {
      accesses++;
      throw new Error("must not run");
    },
  });
  assert.equal((await handler(request(null))).status, 401);
  assert.equal((await handler(request("wrong"))).status, 401);
  assert.equal(
    (await handler(new Request("https://example.invalid"))).status,
    405,
  );
  assert.equal(accesses, 0);
});

test("unconfigured cloud worker fails closed", async () => {
  const handler = createWorkerHandler({ env: { get: () => undefined } });
  assert.equal((await handler(request())).status, 503);
});

test("idle/daily-capped/leased cloud worker never queries a source", async () => {
  let queries = 0;
  const handler = createWorkerHandler({
    env,
    database: () => ({ rpc: async () => ({ data: null, error: null }) }),
    provider: {
      discover: async () => {
        queries++;
        return [];
      },
    },
  });
  const response = await handler(request());
  assert.deepEqual(await response.json(), { idle: true });
  assert.equal(queries, 0);
});

test("cloud job and tenant come only from a leased database claim, never request input", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  let queries = 0;
  const handler = createWorkerHandler({
    env,
    database: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data:
            name === "pa_cloud_claim"
              ? { job, token }
              : { processed: 0, inserted: 0 },
          error: null,
        };
      },
    }),
    provider: {
      discover: async (input, signal) => {
        queries++;
        assert.equal(input.city, "Karachi");
        assert.ok(signal);
        return [];
      },
    },
  });
  const response = await handler(
    request(
      secret,
      JSON.stringify({
        job_id: randomUUID(),
        user_id: randomUUID(),
        city: "attacker override",
      }),
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(queries, 1);
  assert.deepEqual(calls, [
    { name: "pa_cloud_claim", args: undefined },
    {
      name: "pa_cloud_commit",
      args: { p_job: job.id, p_token: token, p_rows: [] },
    },
  ]);
  assert.equal((await response.json()).mode, "listing-only");
});

test("provider failure records a retry and never fabricates a completed empty search", async () => {
  const calls: string[] = [];
  const handler = createWorkerHandler({
    env,
    database: () => ({
      rpc: async (name, args) => {
        calls.push(name);
        if (name === "pa_cloud_fail")
          assert.match(String(args?.p_error), /HTTP 429/);
        return {
          data: name === "pa_cloud_claim" ? { job, token } : null,
          error: null,
        };
      },
    }),
    provider: {
      discover: async () => {
        throw new Error("Provider HTTP 429");
      },
    },
  });
  assert.equal((await handler(request())).status, 502);
  assert.deepEqual(calls, ["pa_cloud_claim", "pa_cloud_fail"]);
});

test("commit failure does not report success", async () => {
  const calls: string[] = [];
  const handler = createWorkerHandler({
    env,
    database: () => ({
      rpc: async (name) => {
        calls.push(name);
        return {
          data: name === "pa_cloud_claim" ? { job, token } : null,
          error:
            name === "pa_cloud_commit"
              ? { message: "Stale cloud worker lease" }
              : null,
        };
      },
    }),
    provider: { discover: async () => [] },
  });
  assert.equal((await handler(request())).status, 502);
  assert.deepEqual(calls, [
    "pa_cloud_claim",
    "pa_cloud_commit",
    "pa_cloud_fail",
  ]);
});

test("portable cloud input parser matches supported Zod job limits and rejects category prototypes", async () => {
  const { parseCloudSearch, parseProviderPayload } =
    await import("../src/lib/discovery-core");
  const { jobSchema } = await import("../src/lib/validation");
  assert.deepEqual(parseCloudSearch(job), jobSchema.parse(job));
  for (const patch of [
    { category: "__proto__" },
    { max_results: 101 },
    { city: "" },
    { country: 42 },
    { requirements: {} },
  ])
    assert.throws(() => parseCloudSearch({ ...job, ...patch }));
  for (const value of [
    null,
    {},
    { elements: new Array(1001).fill({}) },
    { elements: [{ id: -1, type: "node" }] },
    { elements: [{ id: 1, type: "node", tags: { name: 12 } }] },
  ])
    assert.throws(() => parseProviderPayload(value));
});

test("shared portable provider preserves provenance and the Node fingerprint without actual network access", async () => {
  const { discoverOpenStreetMap } = await import("../src/lib/discovery-core");
  const { fingerprint } = await import("../src/lib/discovery");
  const { jobSchema } = await import("../src/lib/validation");
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), "https://example.invalid/overpass");
    assert.equal(init?.method, "POST");
    return Response.json({
      elements: [
        {
          id: 123,
          type: "node",
          lat: 24.86,
          lon: 67.01,
          tags: {
            name: "TEST ONLY Dental",
            phone: "+923000000000",
            website: "example.invalid",
          },
        },
      ],
    });
  };
  try {
    const rows = await discoverOpenStreetMap(
      jobSchema.parse(job),
      "https://example.invalid/overpass",
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].fingerprint,
      fingerprint("TEST ONLY Dental", "Karachi|Pakistan|24.860,67.010"),
    );
    assert.equal(rows[0].source_url, "https://www.openstreetmap.org/node/123");
    assert.match(String(rows[0].facts.attribution), /OpenStreetMap/);
    assert.equal(requests, 1); // In particular, the business website was NOT requested.
  } finally {
    globalThis.fetch = previous;
  }
});

test("failure logging connection errors still return a controlled failure and leave lease recovery possible", async () => {
  const handler = createWorkerHandler({
    env,
    database: () => ({
      rpc: async (name) => {
        if (name === "pa_cloud_fail") throw new Error("Connection unavailable");
        return { data: { job, token }, error: null };
      },
    }),
    provider: {
      discover: async () => {
        throw new Error("Provider unavailable");
      },
    },
  });
  assert.equal((await handler(request())).status, 502);
});
