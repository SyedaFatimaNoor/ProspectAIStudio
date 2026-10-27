import test from "node:test";
import assert from "node:assert/strict";
import {
  discoveryResultLimit,
  validateDiscoveryForm,
  discoveryBlockReason,
} from "../src/lib/discovery-form";
import { emptyWorkspace, type Workspace } from "../src/lib/types";
import { workerIsKnownPaused } from "../src/lib/cloud-worker";

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
  data.config.worker.enabled = true;
  data.config.worker.daily_attempts = 20;
  assert.equal(
    discoveryBlockReason(data),
    null,
    "daily cap delays processing, not job storage",
  );
});
