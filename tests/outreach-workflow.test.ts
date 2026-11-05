import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasOutreachEvidence,
  outreachContactsMatch,
  outreachEligibility,
  publicContactForChannel,
} from "../src/lib/outreach";
import {
  outreachBusiness,
  outreachRun,
  publicOutreachPhone,
} from "./outreach-fixtures";

const base = {
  business: outreachBusiness,
  channel: "whatsapp",
  recipient: publicOutreachPhone,
  suppressions: [],
  runs: [outreachRun],
};

test("a source-backed verified lead with its public phone is eligible", () => {
  assert.deepEqual(outreachEligibility(base), { allowed: true });
  assert.equal(
    publicContactForChannel(outreachBusiness, "whatsapp"),
    publicOutreachPhone,
  );
  assert.equal(hasOutreachEvidence(outreachBusiness, [outreachRun]), true);
});

test("public phone formatting from OSM matches its normalized value", () => {
  assert.equal(
    outreachContactsMatch("+49 345 5110712", publicOutreachPhone),
    true,
  );
  assert.equal(
    outreachContactsMatch("unrecorded-contact", publicOutreachPhone),
    false,
  );
});

test("no selected lead cannot create a draft", () => {
  const result = outreachEligibility({ ...base, business: null });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "no_lead");
});

test("a lead without source-backed evidence cannot create a draft", () => {
  const business = {
    ...outreachBusiness,
    source_observed_at: null,
    facts: { ...outreachBusiness.facts, evidence: [] },
  };
  const result = outreachEligibility({ ...base, business, runs: [] });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "no_evidence");
});

test("a suppressed contact cannot create a draft", () => {
  const result = outreachEligibility({
    ...base,
    suppressions: [{ contact: publicOutreachPhone }],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "suppressed");
});

test("a lead without a public contact cannot create a draft", () => {
  const business = { ...outreachBusiness, phone: null, email: null };
  const result = outreachEligibility({ ...base, business, recipient: "" });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "no_public_contact");
});

test("an unverified lead cannot create a draft", () => {
  const business = {
    ...outreachBusiness,
    activity_status: "unverified",
    verification_status: "Unverified",
  };
  const result = outreachEligibility({ ...base, business });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "unverified");
});

test("recipient must match the source-recorded public contact", () => {
  const result = outreachEligibility({
    ...base,
    recipient: "unrecorded-contact",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "recipient_mismatch");
});

test("server actions record distinct audit labels and keep sending disabled", () => {
  const source = readFileSync(
    new URL("../src/app/api/actions/route.ts", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Draft created",
    "Draft edited",
    "Draft approved",
    "Draft exported",
    "Contact suppressed",
  ])
    assert.ok(source.includes(label), `missing audit label: ${label}`);
  assert.match(source, /status: 403/);
  assert.match(
    source,
    /Sending is disabled\. No messaging provider is authorised/,
  );
  assert.doesNotMatch(source, /sendEmail\(|sendWhatsApp\(|whatsapp\.send\(/);
});

test("workspace API exposes tenant-scoped audit logs", () => {
  const source = readFileSync(
    new URL("../src/app/api/workspace/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /audit_logs: "audit_logs"/);
});
