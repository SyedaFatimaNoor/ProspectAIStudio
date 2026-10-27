import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCandidate, verifyBusiness } from "../src/lib/verification";
import { isPublicIP, validateURL } from "../src/lib/safe-url";
import {
  normalise,
  fingerprint,
  isDuplicate,
  overpassQuery,
  OpenStreetMapProvider,
  type DiscoveredBusiness,
} from "../src/lib/discovery";
import {
  jobSchema,
  messageSchema,
  settingsSchema,
  manualSchema,
} from "../src/lib/validation";
import { factBasedConcept } from "../src/lib/proposal";
import { csvCell } from "../src/lib/utils";
import { aiConfigured, CompatibleAI } from "../src/lib/ai";
import type { Business } from "../src/lib/types";
const business = {
  id: "bf4941be-e03a-454b-905c-ae57c247e8e3",
  name: "TEST FIXTURE — NOT A REAL LEAD",
  category: "cafe",
  city: "Test City",
  country: "Test Country",
  source_url: "https://example.org/listing",
  website: null,
  activity_status: "unverified",
} as Business;
const search = {
  country: "Pakistan",
  city: "Karachi",
  category: "cafe",
  max_results: 25,
  keywords: "",
  service_area: "",
  requirements: { public_contact: false, website_review: true },
} as const;
test("normalisation preserves international business names", () => {
  assert.equal(normalise("Café  Noor!"), "cafénoor");
  assert.equal(normalise("نور"), "نور");
});
test("fingerprint is stable across punctuation and case", () =>
  assert.equal(
    fingerprint("Test Café!", "Test City"),
    fingerprint("test café", "test city"),
  ));
test("deduplication handles source IDs, fingerprints, phones and official domains", () => {
  const a = {
    name: "Test",
    city: "Test",
    provider: "osm",
    source_id: "1",
    fingerprint: "a",
    phone: "+92 300 1234567",
    website: "https://www.example.org",
  } as DiscoveredBusiness;
  assert.equal(isDuplicate(a, { ...a, fingerprint: "b" }), true);
  assert.equal(
    isDuplicate(a, {
      ...a,
      source_id: "2",
      fingerprint: "b",
      phone: "+923001234567",
    }),
    true,
  );
  assert.equal(
    isDuplicate(a, {
      ...a,
      source_id: "3",
      fingerprint: "c",
      phone: null,
      website: "https://example.org",
    }),
    true,
  );
  assert.equal(
    isDuplicate(a, {
      ...a,
      source_id: "4",
      fingerprint: "d",
      name: "Different",
      phone: null,
      website: null,
    }),
    false,
  );
});
test("Overpass query is bounded and escapes user-controlled names", () => {
  const q = overpassQuery({ ...search, city: 'Test";out;[.*' });
  assert.match(q, /timeout:35/);
  assert.match(q, /out meta center 75/);
  assert.ok(q.includes('\\"'));
  assert.ok(q.includes("\\\\."));
});
test("jobs reject unsupported categories, unbounded queries, and empty locations", () => {
  assert.equal(
    jobSchema.safeParse({ ...search, max_results: 101 }).success,
    false,
  );
  assert.equal(jobSchema.safeParse({ ...search, city: " " }).success, false);
  assert.equal(
    jobSchema.safeParse({ ...search, category: "arbitrary-query" }).success,
    false,
  );
  assert.equal(jobSchema.safeParse(search).success, true);
});
test("unconfigured discovery fails rather than fabricating success", async () => {
  const old = process.env.OVERPASS_URL;
  delete process.env.OVERPASS_URL;
  await assert.rejects(
    new OpenStreetMapProvider().discover(search),
    /No source was queried/,
  );
  if (old) process.env.OVERPASS_URL = old;
});
test("website classifier distinguishes social, directory, parking and candidates", () => {
  assert.equal(
    classifyCandidate("https://instagram.com/test"),
    "social_profile",
  );
  assert.equal(classifyCandidate("https://maps.app.goo.gl/test"), "directory");
  assert.equal(classifyCandidate("https://sedo.com/test"), "parking_provider");
  assert.equal(classifyCandidate("https://example.org"), "official_candidate");
  assert.equal(
    classifyCandidate("https://instagram.com.attacker.org"),
    "official_candidate",
  );
});
test("URL validation blocks non-web protocols, credentials, unusual ports and local hosts", () => {
  for (const u of [
    "file:///etc/passwd",
    "http://localhost",
    "http://127.1",
    "http://169.254.169.254",
    "http://[::1]",
    "https://user:pass@example.org",
    "http://example.org:3000",
    "http://example.local",
  ])
    assert.throws(() => validateURL(u), u);
  assert.equal(validateURL("https://example.org").hostname, "example.org");
});
test("public IP checks reject private, reserved, mapped and metadata ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.17.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.1.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicIP(ip), false, ip);
  assert.equal(isPublicIP("1.1.1.1"), true);
  assert.equal(isPublicIP("2606:4700:4700::1111"), true);
});
test("a missing website link never proves website absence or current operation", async () => {
  const r = await verifyBusiness(business);
  assert.equal(r.verification_status, "Manual review required");
  assert.notEqual(r.activity_status, "verified_active");
  assert.notEqual(r.website_status, "no_website_high_confidence");
  assert.ok(r.evidence.every((e) => e.timestamp));
  assert.match(r.explanation, /20\/100/);
});
test("timeouts do not become no-website decisions", async () => {
  const b = { ...business, website: "https://example.org" };
  const r = await verifyBusiness(b, async (url) => ({
    url,
    final_url: url,
    status: null,
    redirects: [],
    error: "Timed out",
  }));
  assert.equal(r.website_status, "candidate_found");
  assert.equal(r.verification_status, "Manual review required");
  assert.match(r.evidence.at(-1)!.detail, /No absence inference/);
});
test("reachable source-linked website is only an ownership candidate", async () => {
  const r = await verifyBusiness(
    { ...business, website: "https://example.org" },
    async (url) => ({ url, final_url: url, status: 200, redirects: [] }),
  );
  assert.equal(r.website_status, "candidate_found");
  assert.equal(r.website_confidence, 20);
});
test("redirects to social profiles are classified separately", async () => {
  const r = await verifyBusiness(
    { ...business, website: "https://example.org" },
    async (url) => ({
      url,
      final_url: "https://facebook.com/test",
      status: 200,
      redirects: ["https://facebook.com/test"],
    }),
  );
  assert.equal(r.candidates[0].classification, "social_profile");
  assert.equal(r.website_status, "social_only_candidate");
});
test("external provider failure remains a failure", async () => {
  await assert.rejects(
    verifyBusiness(business, undefined, {
      search: async () => {
        throw new Error("provider rate limit");
      },
    }),
    /provider rate limit/,
  );
});
test("outreach validates channel-specific recipients", () => {
  const m = {
    business_id: business.id,
    channel: "email",
    recipient: "bad",
    subject: "Test",
    body: "Test",
  };
  assert.equal(messageSchema.safeParse(m).success, false);
  assert.equal(
    messageSchema.safeParse({ ...m, recipient: "test@example.org" }).success,
    true,
  );
  assert.equal(
    messageSchema.safeParse({
      ...m,
      channel: "whatsapp",
      recipient: "03001234567",
    }).success,
    false,
  );
  assert.equal(
    messageSchema.safeParse({
      ...m,
      channel: "whatsapp",
      recipient: "+923001234567",
    }).success,
    true,
  );
});
test("settings enforce retention and confidence boundaries", () => {
  assert.equal(
    settingsSchema.safeParse({
      search_limit: 25,
      verification_threshold: 85,
      retention_days: 90,
    }).success,
    true,
  );
  assert.equal(
    settingsSchema.safeParse({
      search_limit: 500,
      verification_threshold: 2,
      retention_days: 0,
    }).success,
    false,
  );
});
test("manual evidence rejects short reasoning and non-http source URLs", () => {
  const m = {
    business_id: business.id,
    activity: "verified_active",
    website: "manual_review",
    explanation: "short",
    source_url: "javascript:alert(1)",
    observed_at: "2026-10-23",
  };
  assert.equal(manualSchema.safeParse(m).success, false);
});
test("fact-based concepts are transparent and do not fabricate facts", () => {
  const text = factBasedConcept(business);
  assert.match(text, /not built, published, or approved/);
  assert.match(text, /Do not invent/);
  assert.match(text, /owner-confirmed/);
  assert.ok(text.includes(business.name));
});
test("CSV export mitigates spreadsheet formula injection and quotes delimiters", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("normal"), '"normal"');
});
test("AI gracefully reports missing configuration", async () => {
  const old = {
    ollama: process.env.OLLAMA_API_KEY,
    base: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
  delete process.env.OLLAMA_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  try {
    assert.equal(aiConfigured(), false);
    await assert.rejects(
      new CompatibleAI().generateConcept(business),
      /AI is not configured/,
    );
  } finally {
    for (const [name, value] of Object.entries({
      OLLAMA_API_KEY: old.ollama,
      AI_BASE_URL: old.base,
      AI_MODEL: old.model,
    })) {
      if (value) process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test("Ollama Cloud uses a dedicated server key and native bounded chat request", async () => {
  const old = {
    ollama: process.env.OLLAMA_API_KEY,
    base: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    fetch: globalThis.fetch,
  };
  let url = "";
  let init: RequestInit | undefined;
  process.env.OLLAMA_API_KEY = "test-only-ollama-key";
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  globalThis.fetch = (async (input, request) => {
    url = String(input);
    init = request;
    return new Response(
      JSON.stringify({
        model: "gemma4:31b",
        message: { role: "assistant", content: "TEST ONLY — Ollama reply" },
        done: true,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    assert.equal(aiConfigured(), true);
    assert.equal(
      await new CompatibleAI().generateConcept({
        name: "TEST ONLY — Fixture Café",
        category: "cafe",
        city: "Karachi",
        country: "Pakistan",
      }),
      "TEST ONLY — Ollama reply",
    );
    const endpoint = new URL(url);
    assert.equal(endpoint.protocol, "https:");
    assert.equal(endpoint.hostname, "ollama.com");
    assert.equal(endpoint.pathname, "/api/chat");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-only-ollama-key",
    );
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "gemma4:31b");
    assert.equal(request.stream, false);
    assert.equal(request.options.temperature, 0.4);
    assert.equal(request.options.num_predict, 2200);
  } finally {
    if (old.ollama) process.env.OLLAMA_API_KEY = old.ollama;
    else delete process.env.OLLAMA_API_KEY;
    if (old.base) process.env.AI_BASE_URL = old.base;
    else delete process.env.AI_BASE_URL;
    if (old.model) process.env.AI_MODEL = old.model;
    else delete process.env.AI_MODEL;
    globalThis.fetch = old.fetch;
  }
});
