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

test("cloud worker uses constant-time comparison and rejects missing, short and wrong tokens", () => {
  assert.equal(validWorkerToken(secret, secret), true);
  for (const value of [null, "", "wrong", secret + "x", "x".repeat(1000)])
    assert.equal(validWorkerToken(secret, value), false);
  assert.equal(validWorkerToken("short", "short"), false);
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
