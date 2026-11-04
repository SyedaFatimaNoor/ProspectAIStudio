import test from "node:test";
import assert from "node:assert/strict";
import {
  clientRateLimitKey,
  rateLimitHeaders,
  takeRateLimit,
} from "../src/lib/rate-limit";

test("rate limiter applies a bounded window and exposes retry metadata", () => {
  const now = 1_000_000;
  const key = `test-${crypto.randomUUID()}`;
  const first = takeRateLimit(key, { limit: 2, windowMs: 60_000 }, now);
  const second = takeRateLimit(key, { limit: 2, windowMs: 60_000 }, now);
  const denied = takeRateLimit(key, { limit: 2, windowMs: 60_000 }, now);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.remaining, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 60);
  assert.deepEqual(rateLimitHeaders(denied), {
    "Cache-Control": "private, no-store, max-age=0",
    "X-RateLimit-Limit": "2",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "60",
    "Retry-After": "60",
  });
  assert.equal(
    takeRateLimit(key, { limit: 2, windowMs: 60_000 }, now + 60_001).allowed,
    true,
  );
});

test("rate-limit identifiers prefer the trusted deployment forwarding header", () => {
  const headers = new Headers({
    "x-vercel-forwarded-for": "203.0.113.4",
    "x-forwarded-for": "198.51.100.8, proxy",
  });
  assert.equal(clientRateLimitKey(headers, "api"), "api:203.0.113.4");
  assert.equal(
    clientRateLimitKey(new Headers({ "x-forwarded-for": "198.51.100.8, proxy" }), "api"),
    "api:198.51.100.8",
  );
});
