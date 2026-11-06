import test from "node:test";
import assert from "node:assert/strict";
import { checkProviderHealth } from "../src/lib/provider-health";

const db = {} as never;

function withDiscoveryEndpoint(run: () => Promise<void>) {
  const old = {
    overpass: process.env.OVERPASS_URL,
    extract: process.env.OSM_EXTRACT_PATH,
    snapshot: process.env.OSM_SNAPSHOT,
  };
  process.env.OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  delete process.env.OSM_EXTRACT_PATH;
  delete process.env.OSM_SNAPSHOT;
  return run().finally(() => {
    if (old.overpass) process.env.OVERPASS_URL = old.overpass;
    else delete process.env.OVERPASS_URL;
    if (old.extract) process.env.OSM_EXTRACT_PATH = old.extract;
    else delete process.env.OSM_EXTRACT_PATH;
    if (old.snapshot) process.env.OSM_SNAPSHOT = old.snapshot;
    else delete process.env.OSM_SNAPSHOT;
  });
}

function withFetch(
  implementation: typeof fetch,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  return run().finally(() => {
    globalThis.fetch = previous;
  });
}

test("bounded discovery health check records a valid successful observation", async () =>
  withDiscoveryEndpoint(() =>
    withFetch(async (url, init) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.hostname, "overpass-api.de");
      assert.match(parsed.searchParams.get("data") || "", /out 1;/);
      assert.equal(init?.method, "GET");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("accept"), null);
      assert.equal(headers.get("content-type"), null);
      assert.match(headers.get("user-agent") || "", /^ProspectAI\/1\.0 /);
      return Response.json({ elements: [] });
    }, async () => {
      const health = await checkProviderHealth("discovery", db);
      assert.equal(health.status, "reachable");
      assert.equal(health.provider_configured, true);
      assert.equal(health.provider_hostname, "overpass-api.de");
      assert.equal(health.http_status, 200);
      assert.equal(health.response_valid, true);
      assert.ok(health.requested_at);
      assert.ok(health.checked_at);
      assert.ok(typeof health.response_time_ms === "number");
      assert.ok(health.last_success_at);
      assert.equal(health.last_failed_at, null);
      assert.equal(health.last_error, null);
      assert.match(health.recommended_action, /worker is not enabled/i);
    }),
  ));

test("HTTP 406 health check is blocked and keeps the worker paused", async () =>
  withDiscoveryEndpoint(() =>
    withFetch(async () => new Response("Not acceptable", { status: 406 }), async () => {
      const health = await checkProviderHealth("discovery", db);
      assert.equal(health.status, "blocked");
      assert.equal(health.http_status, 406);
      assert.equal(health.response_valid, false);
      assert.equal(health.last_success_at, null);
      assert.ok(health.last_failed_at);
      assert.match(health.last_error || "", /HTTP 406/);
      assert.match(health.recommended_action, /keep the worker paused/i);
    }),
  ));

test("invalid and timed-out health responses use distinct safe states", async () =>
  withDiscoveryEndpoint(async () => {
    await withFetch(async () => new Response("not JSON", { status: 200 }), async () => {
      const health = await checkProviderHealth("discovery", db);
      assert.equal(health.status, "invalid_response");
      assert.equal(health.http_status, 200);
      assert.equal(health.response_valid, false);
    });
    await withFetch(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const keepAlive = setInterval(() => undefined, 1_000);
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            clearInterval(keepAlive);
            reject(new DOMException("Timed out", "TimeoutError"));
          });
        }),
      async () => {
        const health = await checkProviderHealth("discovery", db);
        assert.equal(health.status, "timeout");
        assert.equal(health.http_status, null);
        assert.equal(health.response_valid, null);
      },
    );
  }));
