import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverOpenStreetMap,
  overpassReferer,
  overpassUserAgent,
  type OverpassProviderError,
  type OverpassErrorCategory,
  type OverpassRequestLog,
} from "../src/lib/discovery-core";
import {
  sanitiseProviderExcerpt,
  overpassEndpoint,
} from "../src/lib/overpass-request";
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
const endpoint = overpassEndpoint;

function logs() {
  const entries: OverpassRequestLog[] = [];
  return { entries, log: (entry: OverpassRequestLog) => entries.push(entry) };
}

function assertSafeLog(
  entry: OverpassRequestLog,
  category: OverpassErrorCategory,
  status: number | null,
) {
  assert.deepEqual(Object.keys(entry).sort(), [
    "error_category",
    "http_method",
    "provider",
    "provider_hostname",
    "request_id",
    "response_body_length",
    "response_content_type",
    "response_excerpt",
    "response_time_ms",
    "status_code",
  ]);
  assert.equal(entry.provider, "openstreetmap");
  assert.equal(entry.provider_hostname, "overpass-api.de");
  assert.equal(entry.http_method, "POST");
  assert.equal(entry.error_category, category);
  assert.equal(entry.status_code, status);
  assert.ok(entry.response_time_ms >= 0);
  assert.ok(entry.response_excerpt.length <= 500);
  const serialized = JSON.stringify(entry);
  assert.doesNotMatch(
    serialized,
    /authorization|api[_ -]?key|password|secret|token|cookie|private contact/i,
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

test("Overpass POST uses the official form body and minimal identifying headers", async () => {
  const collected = logs();
  const rows = await discoverOpenStreetMap(input, endpoint, undefined, {
    requestId: "test-overpass-success",
    log: collected.log,
    fetch: async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(new URL(String(url)).search, "");
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get("content-type"),
        "application/x-www-form-urlencoded",
      );
      assert.equal(headers.get("accept"), null);
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("user-agent"), overpassUserAgent);
      assert.match(headers.get("user-agent") || "", /^ProspectAI\/1\.0 /);
      assert.equal(headers.get("referer"), overpassReferer);
      const body = String(init?.body);
      assert.match(body, /^data=/);
      assert.match(decodeURIComponent(body), /\[out:json\]\[timeout:25\]/);
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
  assert.equal(
    collected.entries[0].response_excerpt,
    "[successful provider response omitted]",
  );
});

test("HTTP 406 is classified from the safe diagnostic, not assumed to be an endpoint ban", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        requestId: "test-overpass-406",
        log: collected.log,
        fetch: async () =>
          new Response(
            "<html><body>An appropriate representation could not be found.</body></html>",
            {
              status: 406,
              headers: { "content-type": "text/html" },
            },
          ),
      }),
    (error) => providerError(error, "provider_not_acceptable", 406),
  );
  const entry = collected.entries[0];
  assertSafeLog(entry, "provider_not_acceptable", 406);
  assert.equal(entry.response_content_type, "text/html");
  assert.ok(entry.response_body_length > 0);
  assert.match(entry.response_excerpt, /appropriate representation/i);
  assert.doesNotMatch(entry.response_excerpt, /<html>/i);
});

test("HTTP 406 with a policy body is categorised as a policy block", async () => {
  const collected = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        log: collected.log,
        fetch: async () =>
          new Response("Your hosting platform is blocked by policy", {
            status: 406,
            headers: { "content-type": "text/plain" },
          }),
      }),
    (error) => providerError(error, "provider_policy_blocked", 406),
  );
  assertSafeLog(collected.entries[0], "provider_policy_blocked", 406);
});

test("provider status categories are safe and bounded", async () => {
  const cases: Array<[number, OverpassProviderError["category"]]> = [
    [400, "provider_bad_request"],
    [429, "provider_rate_limited"],
    [503, "provider_server_error"],
  ];
  for (const [status, category] of cases) {
    const collected = logs();
    await assert.rejects(
      () =>
        discoverOpenStreetMap(input, endpoint, undefined, {
          log: collected.log,
          fetch: async () => new Response("provider diagnostic", { status }),
        }),
      (error) => providerError(error, category, status),
    );
    assertSafeLog(collected.entries[0], category, status);
  }
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
            const keepAlive = setInterval(() => undefined, 1_000);
            const signal = init?.signal as AbortSignal;
            signal.addEventListener("abort", () => {
              clearInterval(keepAlive);
              reject(new DOMException("Timed out", "TimeoutError"));
            });
          }),
      }),
    (error) => providerError(error, "provider_timeout", null),
  );
  assertSafeLog(collected.entries[0], "provider_timeout", null);
});

test("invalid JSON and empty provider bodies receive distinct safe categories", async () => {
  const invalid = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        log: invalid.log,
        fetch: async () => new Response("not JSON", { status: 200 }),
      }),
    (error) => providerError(error, "provider_invalid_response", 200),
  );
  assertSafeLog(invalid.entries[0], "provider_invalid_response", 200);

  const empty = logs();
  await assert.rejects(
    () =>
      discoverOpenStreetMap(input, endpoint, undefined, {
        log: empty.log,
        fetch: async () => new Response("", { status: 200 }),
      }),
    (error) => providerError(error, "provider_empty_response", 200),
  );
  assertSafeLog(empty.entries[0], "provider_empty_response", 200);
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

test("diagnostic excerpts are redacted and bounded", () => {
  const excerpt = sanitiseProviderExcerpt(
    `Authorization: Bearer abc.def.ghi token=secret-value cookie=sid=1 <div>Contact owner@example.com +923000000000 https://example.invalid/private ${"x".repeat(700)}</div>`,
  );
  assert.ok(excerpt.length <= 500);
  assert.doesNotMatch(excerpt, /abc\.def\.ghi|secret-value|sid=1|owner@example\.com|\+923000000000|https:\/\/example\.invalid/i);
  assert.match(excerpt, /redacted/i);
});
