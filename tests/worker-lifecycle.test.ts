import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedResponseTime,
  classifyWorkerFailure,
  safeWorkerFailureDetail,
  workerSource,
} from "../src/lib/worker-lifecycle";

test("worker lifecycle classifies only safe transient provider failures for retry", () => {
  for (const status of [400, 401, 403, 404, 405, 406, 410, 422]) {
    const failure = classifyWorkerFailure(new Error(`Provider HTTP ${status}`));
    assert.equal(failure.category, "provider_blocked");
    assert.equal(failure.retryable, false);
  }
  assert.deepEqual(classifyWorkerFailure(new Error("Provider HTTP 429")), {
    category: "rate_limited",
    httpStatus: 429,
    retryable: true,
  });
  assert.equal(
    classifyWorkerFailure(new Error("Provider HTTP 503")).retryable,
    true,
  );
  assert.equal(
    classifyWorkerFailure(new Error("fetch failed: socket hang up")).retryable,
    true,
  );
  assert.deepEqual(
    classifyWorkerFailure({
      message: "Provider returned incomplete response",
      category: "incomplete_response",
      status: 200,
    }),
    { category: "invalid_response", httpStatus: 200, retryable: false },
  );
  assert.equal(
    classifyWorkerFailure(new Error("invalid bounded discovery job")).retryable,
    false,
  );
});

test("worker lifecycle stores safe actionable failure details instead of raw provider content", () => {
  const raw = new Error(
    "Provider HTTP 406: provider response <private diagnostic>",
  );
  const detail = safeWorkerFailureDetail(raw);
  assert.match(detail, /HTTP 406/);
  assert.match(detail, /Automatic retry is disabled/);
  assert.doesNotMatch(detail, /private diagnostic/);
});

test("worker lifecycle telemetry source keeps endpoint paths and credentials out of storage", () => {
  assert.equal(
    workerSource(
      false,
      "https://user:password@overpass-api.example/api/interpreter?data=secret",
    ),
    "openstreetmap:overpass-api.example",
  );
  assert.equal(
    workerSource(true, "https://ignored.example/private"),
    "openstreetmap:snapshot",
  );
  assert.equal(workerSource(false, "not a URL"), "openstreetmap:unknown");
});

test("worker response-duration telemetry is bounded", () => {
  assert.equal(boundedResponseTime(-Infinity), 80_000);
  assert.equal(boundedResponseTime(Infinity), 0);
});
