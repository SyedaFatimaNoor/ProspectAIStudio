import test from "node:test";
import assert from "node:assert/strict";
import { factBasedConcept } from "../src/lib/proposal";
import {
  renderConceptMarkdown,
  selectVerifiedLeadFacts,
} from "../src/lib/ai-schema";
import {
  composeStudioMarkdown,
  defaultStudioSections,
  formatStudioTimestamp,
  parseStudioSections,
  studioEvidenceFrom,
  type StudioDocumentContext,
} from "../src/lib/studio";
import type { Business, Proposal, Run } from "../src/lib/types";
import { publicVerifiedLead, validConcept } from "./ai-fixtures";

const savedAt = "2026-11-05T12:30:00.000Z";
const generatedAt = "2026-11-05T12:00:00.000Z";

const business: Business = {
  id: publicVerifiedLead.id,
  name: publicVerifiedLead.name,
  category: publicVerifiedLead.category,
  city: publicVerifiedLead.city,
  country: publicVerifiedLead.country,
  phone: null,
  email: null,
  website: null,
  source_url: publicVerifiedLead.source_url,
  provider: publicVerifiedLead.provider,
  source_id: publicVerifiedLead.source_id,
  source_observed_at: publicVerifiedLead.source_observed_at,
  activity_status: "verified_active",
  website_status: "manual_review",
  activity_confidence: 85,
  website_confidence: 20,
  verification_status: "Verified active",
  outreach_status: "Not contacted",
  notes: "",
  created_at: generatedAt,
  facts: {},
};

const verificationRun: Run = {
  id: "verification-run-fixture",
  business_id: business.id,
  status: "completed",
  explanation:
    "OSM node and official site were reviewed; listing presence is not continuous proof of current operation.",
  evidence: [
    {
      type: "source_link",
      detail:
        "OSM node tags supply name, cafe category, city, country and check date.",
      url: "https://api.openstreetmap.org/api/0.6/node/788761098.json",
      timestamp: "2026-01-30T11:55:45Z",
    },
    {
      type: "official_site",
      detail: "The reachable official site describes the café in Halle.",
      url: "https://www.ntcafe.de/",
      timestamp: "2026-11-05T00:00:00.000Z",
    },
  ],
  created_at: generatedAt,
  error: null,
};

const { facts, snapshot } = selectVerifiedLeadFacts(
  publicVerifiedLead,
  () => generatedAt,
);

const aiProposal: Proposal = {
  id: "ai-concept-fixture",
  business_id: business.id,
  title: `Website concept — ${business.name}`,
  content: renderConceptMarkdown(facts, validConcept(facts), {
    provider: "Ollama Cloud",
    model: "gemma4:31b",
    generated_at: generatedAt,
  }),
  version: 1,
  origin: "ai",
  ai_provider: "Ollama Cloud",
  ai_model: "gemma4:31b",
  generated_at: generatedAt,
  ai_output: validConcept(facts),
  facts_snapshot: snapshot,
  created_at: generatedAt,
  updated_at: savedAt,
};

function context(): StudioDocumentContext {
  return {
    title: `Website concept — ${business.name}`,
    business,
    mode: "ai",
    evidence: studioEvidenceFrom({
      business,
      runs: [verificationRun],
      proposal: aiProposal,
    }),
    ai: {
      provider: "Ollama Cloud",
      model: "gemma4:31b",
      generated_at: generatedAt,
    },
    lastSavedAt: savedAt,
    version: 2,
  };
}

test("Studio document clearly records draft status, source, evidence, saved time and AI metadata", () => {
  const markdown = composeStudioMarkdown(
    defaultStudioSections(context()),
    context(),
  );
  assert.match(markdown, /Status: Draft — editable concept only/);
  assert.match(markdown, /Publication: Not published/);
  assert.match(markdown, /Source business: Café nt/);
  assert.match(markdown, /## Evidence used/);
  assert.match(markdown, /OSM node tags/);
  assert.match(markdown, /Last saved: .*UTC/);
  assert.match(markdown, /Revision: 2/);
  assert.match(markdown, /AI provider and model: Ollama Cloud · gemma4:31b/);
  assert.match(markdown, /A missing website link is not evidence of absence/);
  assert.match(
    markdown,
    /No website has been built, deployed, or published by this workflow/,
  );
  assert.doesNotMatch(
    markdown,
    /business has no website|the business has no website|no official website/i,
  );
  assert.doesNotMatch(markdown, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(
    markdown,
    /\+\d[\d\s().-]{7,}\d|\b\d{3}[-.)\s]?\d{3}[-.)\s]?\d{4}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/,
  );
});

test("Studio structured sections round-trip through the Markdown concept", () => {
  const original = defaultStudioSections(context());
  const edited = {
    ...original,
    headline: "A reviewed concept for Café nt",
    services: "Owner-confirmed drinks and food descriptions only.",
    contact: "Owner-confirmed contact details pending review.",
    callToAction: "Request a human-reviewed proposal.",
    structure: "1. Home\n2. Services\n3. Contact",
    visualDirection: "Proposed navy, warm white, and restrained blue palette.",
    uncertainties:
      "Website status is unverified; a missing link is not evidence of absence.",
  };
  const parsed = parseStudioSections(
    composeStudioMarkdown(edited, context()),
    context(),
  );
  assert.deepEqual(parsed, edited);
});

test("fact-based and AI drafts can be opened in the structured editor without inventing contacts", () => {
  const factBased = parseStudioSections(factBasedConcept(business), context());
  assert.match(factBased.headline, /Café nt/);
  assert.match(factBased.contact, /Contact details were not supplied/);
  assert.match(factBased.visualDirection, /design recommendations/i);
  assert.doesNotMatch(factBased.contact, /@|\+\d|\d{7,}/);

  const generated = parseStudioSections(aiProposal.content, context());
  assert.match(generated.headline, /Café nt/);
  assert.match(generated.services, /editable|owner-confirmed|verified/i);
  assert.match(generated.structure, /Home|About|Visit/);
  assert.match(generated.visualDirection, /Proposed palette/);
  assert.match(
    generated.uncertainties,
    /unverified|not supplied|not evidence/i,
  );
  assert.match(generated.contact, /Contact details were not supplied/);
  assert.doesNotMatch(generated.contact, /@|\+\d|\d{7,}/);
});

test("Studio evidence list uses persisted sources without fabricating contact details", () => {
  const evidence = studioEvidenceFrom({
    business,
    runs: [verificationRun],
    proposal: aiProposal,
  });
  assert.ok(
    evidence.some((item) => item.label === "AI facts snapshot evidence"),
  );
  assert.ok(
    evidence.some((item) => item.label.startsWith("Verification evidence")),
  );
  assert.ok(evidence.some((item) => item.label === "Source provenance"));
  assert.ok(evidence.some((item) => item.label === "Verification state"));
  const serialised = JSON.stringify(evidence);
  assert.doesNotMatch(serialised, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(serialised, /\+\d[\d\s().-]{7,}\d/);
  assert.doesNotMatch(serialised, /business has no website/i);
});

test("missing and invalid saved timestamps remain honest", () => {
  assert.equal(formatStudioTimestamp(null), "Not saved yet");
  assert.equal(formatStudioTimestamp("not-a-date"), "Not saved yet");
  assert.match(formatStudioTimestamp(savedAt), /2026.*UTC/);
});
