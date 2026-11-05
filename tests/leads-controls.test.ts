import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAndSortLeads,
  leadPage,
  duplicateWarning,
} from "../src/lib/leads";
import { exportBusinesses } from "../src/lib/utils";
import type { Business } from "../src/lib/types";
const lead = (id: string, patch: Partial<Business> = {}): Business => ({
  id,
  name: `Lead ${id}`,
  category: "cafe",
  city: "Karachi",
  country: "Pakistan",
  phone: null,
  email: null,
  website: null,
  source_url: `https://source.example/${id}`,
  source_observed_at: "2026-11-05T10:00:00.000Z",
  provider: "openstreetmap",
  source_id: `node/${id}`,
  activity_status: "unverified",
  website_status: "manual_review",
  activity_confidence: 20,
  website_confidence: 10,
  verification_status: "Unverified",
  outreach_status: "Not contacted",
  notes: "",
  created_at: "2026-11-05T10:00:00.000Z",
  facts: {},
  ...patch,
});
const controls = (
  query = "",
  websiteStatus = "all",
  category = "all",
  sort: "newest" | "name" | "confidence" = "newest",
) => ({ query, websiteStatus, category, sort });
test("lead controls search business name, city and country and filter website/category", () => {
  const rows = [
    lead("a", {
      name: "Alpha Coffee",
      city: "Karachi",
      category: "cafe",
      website_status: "website_found",
    }),
    lead("b", {
      name: "Beta Dental",
      city: "Lahore",
      country: "Pakistan",
      category: "dental",
      website_status: "manual_review",
    }),
  ];
  assert.deepEqual(
    filterAndSortLeads(rows, controls("alpha")).map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(
    filterAndSortLeads(rows, controls("lahore")).map((x) => x.id),
    ["b"],
  );
  assert.deepEqual(
    filterAndSortLeads(rows, controls("pakistan", "website_found", "cafe")).map(
      (x) => x.id,
    ),
    ["a"],
  );
});
test("lead sorting, pagination, duplicate warning and empty results are deterministic", () => {
  const rows = Array.from({ length: 11 }, (_, i) =>
    lead(String(i), {
      name: i === 0 ? "Zulu" : `Alpha ${i}`,
      activity_confidence: i,
      created_at: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      duplicate_group_id: i === 1 ? "group" : null,
      duplicate_review_status: i === 1 ? "manual_review" : "not_duplicate",
    }),
  );
  assert.equal(
    filterAndSortLeads(rows, controls("", "all", "all", "name"))[0].name,
    "Alpha 1",
  );
  assert.equal(
    filterAndSortLeads(rows, controls("", "all", "all", "confidence"))[0]
      .activity_confidence,
    10,
  );
  assert.equal(
    filterAndSortLeads(rows, controls("", "all", "all", "newest"))[0].id,
    "10",
  );
  assert.equal(leadPage(rows, 2).rows.length, 1);
  assert.equal(leadPage([], 99).page, 1);
  assert.equal(duplicateWarning(rows).length, 1);
  assert.deepEqual(
    filterAndSortLeads(rows, controls("absent")).map((x) => x.id),
    [],
  );
});
test("CSV whitelists tenant lead fields, includes provenance/confidence, and escapes formulas", () => {
  const csv = exportBusinesses([
    lead("1", {
      name: '=HYPERLINK("bad")',
      verification_status: "Verified active",
      activity_confidence: 88,
      website_confidence: 63,
    }),
  ]);
  assert.match(csv, /Source URL/);
  assert.match(csv, /Source observed at/);
  assert.match(csv, /Verification status/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /https:\/\/source\.example\/1/);
  assert.doesNotMatch(csv, /service_role|token|user_id/i);
});
