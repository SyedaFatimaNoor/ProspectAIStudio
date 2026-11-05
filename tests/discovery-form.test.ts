import test from "node:test";
import assert from "node:assert/strict";
import {
  discoveryResultLimit,
  validateDiscoveryForm,
  discoveryBlockReason,
  discoveryJobErrorMessage,
} from "../src/lib/discovery-form";
import { emptyWorkspace, type Workspace } from "../src/lib/types";
import { workerIsKnownPaused } from "../src/lib/cloud-worker";
import {
  discoveryAvailability,
  discoveryJobOutcome,
  safeOperationalMessage,
} from "../src/lib/discovery-availability";

const valid = {
  country: " Pakistan ",
  city: " کراچی ",
  category: "cafe",
  max_results: 25,
  keywords: "",
  service_area: "",
  requirements: { public_contact: false, website_review: true },
};
const ready = (): Workspace => ({
  ...structuredClone(emptyWorkspace),
  user: { id: "test-only" },
  config: { database: true, discovery: true, ai: false },
});

test("discovery validation trims names, preserves international text and rejects whitespace-only locations", () => {
  const result = validateDiscoveryForm(valid);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.country, "Pakistan");
    assert.equal(result.data.city, "کراچی");
  }
  const invalid = validateDiscoveryForm({ ...valid, country: " ", city: "\t" });
  assert.equal(invalid.success, false);
  assert.equal(invalid.errors.city, "Please enter a city.");
  assert.equal(invalid.errors.country, "Please enter a country.");
});

test("result counts remain strict integers, with both schema and workspace caps", () => {
  for (const max_results of [NaN, 0, -1, 1.5, 101, Infinity, "25", true, null])
    assert.equal(
      validateDiscoveryForm({ ...valid, max_results }).success,
      false,
      String(max_results),
    );
  const capped = validateDiscoveryForm(valid, 10);
  assert.equal(capped.success, false);
  assert.match(capped.errors.max_results, /workspace limit is 10/);
  assert.equal(
    validateDiscoveryForm({ ...valid, max_results: 10 }, 10).success,
    true,
  );
  assert.equal(
    validateDiscoveryForm({ ...valid, max_results: 100 }).success,
    true,
  );
});

test("result limit defaults stay bounded and never use malformed settings", () => {
  assert.equal(discoveryResultLimit(7), 7);
  for (const value of [undefined, NaN, 0, 1000, 2.5])
    assert.equal(discoveryResultLimit(value), 100);
});

test("unsupported categories and oversized optional context are still rejected", () => {
  for (const patch of [
    { category: "unsupported" },
    { keywords: "x".repeat(121) },
    { service_area: "x".repeat(151) },
  ])
    assert.equal(validateDiscoveryForm({ ...valid, ...patch }).success, false);
});

test("a historical HTTP 406 is accurately labelled as a provider rejection", () => {
  assert.match(
    discoveryJobErrorMessage(
      "OpenStreetMap provider returned HTTP 406. Respect endpoint rate limits and retry later.",
    ),
    /endpoint rejected this request/,
  );
  assert.doesNotMatch(
    discoveryJobErrorMessage(
      "OpenStreetMap provider returned HTTP 406. Respect endpoint rate limits and retry later.",
    ),
    /Respect endpoint rate limits/,
  );
  assert.doesNotMatch(
    discoveryJobErrorMessage("Provider failed with token=test-secret-value"),
    /test-secret-value/,
  );
});

test("preview, loading, failed connection and missing setup cannot queue discovery", () => {
  assert.match(discoveryBlockReason(emptyWorkspace)!, /Sign in/);
  assert.match(discoveryBlockReason(ready(), true)!, /loading/);
  assert.match(
    discoveryBlockReason(ready(), false, "Connection failed")!,
    /connection failed/,
  );
  assert.match(
    discoveryBlockReason({
      ...ready(),
      config: { database: false, discovery: true, ai: false },
    })!,
    /Database setup/,
  );
  assert.match(
    discoveryBlockReason({
      ...ready(),
      config: { database: true, discovery: false, ai: false },
    })!,
    /No discovery source/,
  );
});

test("only an explicit paused worker blocks discovery; an unknown separate worker is not falsely treated as down", () => {
  assert.equal(workerIsKnownPaused(undefined), false);
  assert.equal(workerIsKnownPaused({ enabled: true }), false);
  assert.equal(workerIsKnownPaused({ enabled: false }), true);
  assert.equal(workerIsKnownPaused({}), false);
  const data = ready();
  assert.equal(discoveryBlockReason(data), null);
  data.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: null,
  };
  assert.match(discoveryBlockReason(data)!, /paused/);
  data.config.self_hosted_worker = true;
  assert.equal(
    discoveryBlockReason(data),
    null,
    "a locally configured source has its own worker and is not blocked by the hosted scheduler pause",
  );
  data.config.self_hosted_worker = false;
  data.config.worker.enabled = true;
  data.config.worker.daily_attempts = 20;
  assert.equal(
    discoveryBlockReason(data),
    null,
    "daily cap delays processing, not job storage",
  );
});

test("discovery availability distinguishes configuration, snapshot, provider and worker blocks", () => {
  const missing = discoveryAvailability({
    ...ready(),
    config: { database: true, discovery: false, ai: false },
  });
  assert.equal(missing.code, "missing_configuration");
  assert.equal(missing.fixability, "operator");

  const snapshot = discoveryAvailability({
    ...ready(),
    config: {
      database: true,
      discovery: false,
      ai: false,
      snapshot: {
        businesses: 0,
        places: 0,
        oldest_snapshot: null,
        newest_snapshot: null,
        import_status: "empty",
      },
    },
  });
  assert.equal(snapshot.code, "empty_snapshot");
  assert.match(snapshot.reason, /no searchable places or businesses/i);

  const provider406 = discoveryAvailability({
    ...ready(),
    provider_health: [
      {
        provider: "discovery",
        status: "blocked",
        checked_at: "2026-11-05T09:00:00.000Z",
        last_success_at: null,
        latency_ms: 421,
        last_error: "OpenStreetMap provider returned HTTP 406.",
        recommended_action: "Review provider policy.",
      },
    ],
  });
  assert.equal(provider406.code, "provider_406");
  assert.equal(provider406.lastHttpStatus, 406);
  assert.equal(provider406.responseTimeMs, 421);

  const timeout = discoveryAvailability({
    ...ready(),
    provider_health: [
      {
        provider: "discovery",
        status: "unreachable",
        checked_at: "2026-11-05T09:00:00.000Z",
        last_success_at: null,
        latency_ms: 12000,
        last_error: "OpenStreetMap provider health check timed out.",
        recommended_action: "Check network access.",
      },
    ],
  });
  assert.equal(timeout.code, "provider_timeout");

  const paused = ready();
  paused.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: "2026-11-05T09:00:00.000Z",
  };
  assert.equal(discoveryAvailability(paused).code, "worker_paused");
});

test("job outcome copy distinguishes invalid input, provider failures, empty results and completion", () => {
  const job = {
    id: "test-job",
    country: "Pakistan",
    city: "Karachi",
    category: "cafe",
    max_results: 25,
    processed: 0,
    total: 0,
    error: null,
    logs: [],
    created_at: "2026-11-05T09:00:00.000Z",
  };
  assert.equal(
    discoveryJobOutcome({
      ...job,
      status: "failed",
      error: "Invalid bounded discovery job.",
      error_category: "invalid_job",
    })?.title,
    "Invalid search input",
  );
  assert.equal(
    discoveryJobOutcome({
      ...job,
      status: "blocked",
      error: "OpenStreetMap provider returned HTTP 406.",
      error_category: "provider_blocked",
    })?.title,
    "Provider HTTP 406",
  );
  assert.equal(
    discoveryJobOutcome({
      ...job,
      status: "rate_limited",
      error: "OpenStreetMap provider returned HTTP 429.",
      error_category: "rate_limited",
    })?.title,
    "Provider rate limit",
  );
  assert.equal(
    discoveryJobOutcome({ ...job, status: "completed" })?.title,
    "No results found",
  );
  assert.equal(
    discoveryJobOutcome({ ...job, status: "completed", total: 2 })?.title,
    "Successful completion",
  );
});

test("operational display details redact token-shaped values", () => {
  assert.equal(
    safeOperationalMessage("Provider failed; token=abc123"),
    "Provider failed; [redacted]",
  );
  assert.equal(
    safeOperationalMessage("HTTP 406 Authorization: Bearer test-secret-value"),
    "HTTP 406 [redacted]",
  );
});
