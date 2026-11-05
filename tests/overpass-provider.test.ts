import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverOpenStreetMap,
  overpassReferer,
  overpassUserAgent,
  type OverpassProviderError,
  type OverpassRequestLog,
} from "../src/lib/discovery-core";
import type { SearchInput } from "../src/lib/discovery";

const input: SearchInput = {
  country: "Pakistan",
  city: "Karachi",
  category: "cafe",
  keywords: "",
  service_area: "",
  max_results: 5,
  requirements: { public_contact: false, website_review: false },
};
const endpoint = "https://overpass-api.de/api/interpreter";

function logs() {
  const entries: OverpassRequestLog[] = [];
  return { entries, log: (entry: OverpassRequestLog) => entries.push(entry) };
}

function assertSafeLog(
  entry: OverpassRequestLog,
  category: OverpassRequestLog["error_category"],
  status: number | null,
) {
  assert.deepEqual(Object.keys(entry).sort(), [
    "endpoint_hostname",
    "error_category",
    "http_status",
    "provider",
    "request_id",
    "response_time_ms",
  ]);
  assert.equal(entry.provider, "openstreetmap");
  assert.equal(entry.endpoint_hostname, "overpass-api.de");
  assert.equal(entry.error_category, category);
  assert.equal(entry.http_status, status);
  assert.ok(entry.response_time_ms >= 0);
  const serialized = JSON.stringify(entry);
  assert.doesNotMatch(
    serialized,
    /private|contact|email|phone|secret|token|cookie/i,
  );
}

function providerError(
  error: unknown,
  category: OverpassProviderError["category"],
  status: number | null,
) {
  assert.equal((error as OverpassProviderError).name, "OverpassProviderError");
  assert.equal((error as OverpassProviderError).category, category);
  assert.equal((error as OverpassProviderError).status, status);
  return true;
}

test("Overpass form POST uses a transparent policy-compliant request and records safe success metadata", async () => {
  const collected = logs();
  const rows = await discoverOpenStreetMap(input, endpoint, undefined, {
    requestId: "test-overpass-success",
    log: collected.log,
    fetch: async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get("content-type"),
        "application/x-www-form-urlencoded",
      );
      assert.equal(headers.get("accept"), "application/json");
      assert.equal(headers.get("user-agent"), overpassUserAgent);
      assert.equal(headers.get("referer"), overpassReferer);
      const body = String(init?.body);
      assert.match(body, /^data=/);
      assert.match(decodeURIComponent(body), /\[out:json\]\[timeout:35\]/);
      assert.match(decodeURIComponent(body), /nwr\(area\.city\)/);
      return Response.json({
        elements: [
          {
            id: 123,
            type: "node",
            lat: 24.86,
            lon: 67.01,
            tags: {
              name: "TEST ONLY Café",
              "contact:email": "test@example.invalid",
              "contact:phone": "+923000000000",
            },
          },
        ],
      });
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(collected.entries.length, 1);
  assert.equal(collected.entries[0].request_id, "test-overpass-success");
  assertSafeLog(collected.entries[0], "success", 200);
});

test("Overpass HTTP 406 is a provider rejection with safe metadata", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        requestId: "test-overpass-406",
        log: collected.log,
        fetch: async () => new Response("Not acceptable", { status: 406 }),
      }),
    (error) => providerError(error, "provider_rejected", 406),
  );
  assert.equal(collected.entries[0].request_id, "test-overpass-406");
  assertSafeLog(collected.entries[0], "provider_rejected", 406);
});

test("Overpass timeout is reported without claiming an empty result", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        requestId: "test-overpass-timeout",
        timeoutMs: 5,
        log: collected.log,
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("Timed out", "TimeoutError")),
            );
          }),
      }),
    (error) => providerError(error, "timeout", null),
  );
  assertSafeLog(collected.entries[0], "timeout", null);
});

test("Overpass invalid JSON is rejected with a parse category", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        requestId: "test-overpass-invalid-json",
        log: collected.log,
        fetch: async () => new Response("not JSON", { status: 200 }),
      }),
    (error) => providerError(error, "invalid_json", 200),
  );
  assertSafeLog(collected.entries[0], "invalid_json", 200);
});

test("Overpass empty JSON result stays an honest empty result with metadata", async () => {
  const collected = logs();
  const rows = await discoverOpenStreetMap(input, endpoint, undefined, {
    requestId: "test-overpass-empty",
    log: collected.log,
    fetch: async () => Response.json({ elements: [] }),
  });
  assert.deepEqual(rows, []);
  assertSafeLog(collected.entries[0], "empty_result", 200);
});

test("Overpass HTTP 429 is categorised as rate limited", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        requestId: "test-overpass-429",
        log: collected.log,
        fetch: async () => new Response("Too many requests", { status: 429 }),
      }),
    (error) => providerError(error, "rate_limited", 429),
  );
  assertSafeLog(collected.entries[0], "rate_limited", 429);
});
