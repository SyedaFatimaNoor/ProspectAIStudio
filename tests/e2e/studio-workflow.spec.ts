import { test, expect, type Page } from "@playwright/test";
import {
  emptyWorkspace,
  type Business,
  type Proposal,
  type Run,
  type Workspace,
} from "../../src/lib/types";
import {
  renderConceptMarkdown,
  selectVerifiedLeadFacts,
} from "../../src/lib/ai-schema";
import { publicVerifiedLead, validConcept } from "../ai-fixtures";

// Test-only HTTP fixtures. This is a public, source-backed verified lead; no
// production workspace row, real user record, or real website is touched.
const leadId = publicVerifiedLead.id;
const generatedAt = "2026-11-05T12:00:00.000Z";
const saveTimes = ["2026-11-05T12:30:00.000Z", "2026-11-05T12:40:00.000Z"];

const business: Business = {
  id: leadId,
  name: publicVerifiedLead.name,
  category: publicVerifiedLead.category,
  city: publicVerifiedLead.city,
  country: publicVerifiedLead.country,
  phone: null,
  email: null,
  website: null,
  source_url: publicVerifiedLead.source_url,
  source_observed_at: publicVerifiedLead.source_observed_at,
  provider: publicVerifiedLead.provider,
  source_id: publicVerifiedLead.source_id,
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
  business_id: leadId,
  status: "completed",
  explanation:
    "OSM node and official site were reviewed; listing presence is not continuous proof of current operation.",
  evidence: [
    {
      type: "source_link",
      detail:
        "OSM node tags supply the business name, cafe category, city, country, website candidate and check date.",
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

const aiConcept = validConcept(facts);
const aiContent = renderConceptMarkdown(facts, aiConcept, {
  provider: "Ollama Cloud",
  model: "gemma4:31b",
  generated_at: generatedAt,
});

const aiProposalId = "ai-concept-workflow-fixture";

function generatedProposal(version = 1): Proposal {
  return {
    id: aiProposalId,
    business_id: leadId,
    title: `Website concept — ${publicVerifiedLead.name}`,
    content: aiContent,
    version,
    origin: "ai",
    ai_provider: "Ollama Cloud",
    ai_model: "gemma4:31b",
    generated_at: generatedAt,
    ai_output: aiConcept,
    facts_snapshot: snapshot,
    created_at: generatedAt,
    updated_at: generatedAt,
  };
}

function generatedResult(version = 1, regenerated = false) {
  const proposal = generatedProposal(version);
  return {
    content: proposal.content,
    title: proposal.title,
    provider: proposal.ai_provider!,
    model: proposal.ai_model!,
    generated_at: proposal.generated_at!,
    concept: aiConcept,
    facts_snapshot: snapshot,
    regenerated,
    proposal,
  };
}

async function mocked(page: Page) {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-only-account" },
    businesses: [structuredClone(business)],
    runs: [structuredClone(verificationRun)],
    config: { database: true, discovery: false, ai: true },
  };
  const requests: Record<string, unknown>[] = [];
  let saveCount = 0;
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/api/actions", async (route) => {
    const value = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(value);
    if (value.type === "generate_concept") {
      const result = generatedResult();
      state.proposals = [
        result.proposal,
        ...state.proposals.filter((p) => p.id !== result.proposal.id),
      ];
      return route.fulfill({ json: result });
    }
    if (value.type === "save_proposal") {
      const savedAt = saveTimes[Math.min(saveCount++, saveTimes.length - 1)];
      const existing = value.id
        ? state.proposals.find((p) => p.id === value.id)
        : undefined;
      const next: Proposal = existing
        ? {
            ...existing,
            title: String(value.title),
            content: String(value.content),
            version: existing.version + 1,
            updated_at: savedAt,
          }
        : {
            id: `manual-concept-${saveCount}`,
            business_id: String(value.business_id),
            title: String(value.title),
            content: String(value.content),
            version: 1,
            origin: "manual",
            created_at: savedAt,
            updated_at: savedAt,
          };
      state.proposals = [
        next,
        ...state.proposals.filter((p) => p.id !== next.id),
      ];
      return route.fulfill({ json: next });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return { state, requests };
}

test("completes the full Website Studio workflow with a verified test lead", async ({
  page,
}) => {
  const { state, requests } = await mocked(page);
  await page.goto(`/studio?lead=${leadId}`);

  // 1. Select a verified business.
  await expect(page.getByLabel("Business")).toHaveValue(leadId);
  await expect(
    page.getByText("Verified active", { exact: true }).first(),
  ).toBeVisible();

  // 2. Create a fact-based draft without AI.
  await page.getByRole("button", { name: "Create fact-based draft" }).click();
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /draft concept — not built, published, or approved/,
  );
  await expect(
    page.getByText("Not used — fact-based/manual draft"),
  ).toBeVisible();
  expect(requests.some((request) => request.type === "generate_concept")).toBe(
    false,
  );

  // 3. Generate the optional AI draft.
  await page.getByRole("button", { name: "Generate with AI" }).click();
  await expect(
    page.getByText("Ollama Cloud · gemma4:31b").first(),
  ).toBeVisible();
  await expect(page.getByText(/Saved AI concept · revision 1/)).toBeVisible();

  // 4-8. Edit all required structured sections.
  const editedHeadline = "Reviewed concept headline for Café nt";
  const editedServices =
    "Owner-confirmed drinks and food descriptions only; no unverified claims.";
  const editedContact =
    "Owner-confirmed contact details pending human review; no contact invented by AI.";
  const editedCta = "Request a human-reviewed proposal.";
  const editedVisual =
    "Proposed navy, warm white, restrained blue, accessible type, and a calm single-column layout.";
  await page.getByLabel("Headline").fill(editedHeadline);
  await page.getByLabel("Services").fill(editedServices);
  await page.getByLabel("Contact details").fill(editedContact);
  await page.getByLabel("Call to action").fill(editedCta);
  await page.getByLabel("Visual direction").fill(editedVisual);
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    new RegExp(editedHeadline),
  );
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Owner-confirmed contact details pending human review/,
  );
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Not published/,
  );

  // 9. Save the concept.
  await page.getByRole("button", { name: "Save proposal" }).click();
  await expect(page.locator('[data-testid="last-saved-time"]')).toContainText(
    /12:30/,
  );
  await expect(page.locator(".saved-list")).toContainText("Revision 2");

  // 10. Reload the page.
  await page.reload();

  // 11. Confirm persistence and required status/provenance display.
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    new RegExp(editedHeadline),
  );
  await expect(page.getByLabel("Headline")).toHaveValue(editedHeadline);
  await expect(page.getByLabel("Contact details")).toHaveValue(editedContact);
  await expect(page.getByLabel("Visual direction")).toHaveValue(editedVisual);
  await expect(
    page.locator('[data-testid="last-saved-time"]'),
  ).not.toContainText("Not saved yet");
  await expect(page.getByText("Draft status", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Source business", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-status-grid dd strong")).toHaveText(
    "Café nt",
  );
  await expect(
    page.getByRole("heading", { name: "Evidence used" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".studio-evidence li span")
      .filter({ hasText: "OSM node tags supply the business name" })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Last saved time", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI provider and model", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ollama Cloud · gemma4:31b").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Not published", { exact: true }).first(),
  ).toBeVisible();

  // 12. Create a new version.
  await page.getByRole("button", { name: "Create a new version" }).click();
  await expect(page.locator(".saved-list")).toContainText("Revision 3");
  expect(state.proposals[0]?.version).toBe(3);
  expect(
    requests.some(
      (request) =>
        request.type === "save_proposal" && request.new_version === true,
    ),
  ).toBe(true);

  // 13. Preview desktop layout.
  await page.getByRole("button", { name: "Preview desktop layout" }).click();
  await expect(
    page.getByRole("region", { name: "Desktop layout preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Concept-only preview · Not published"),
  ).toBeVisible();

  // 14. Preview mobile layout.
  await page.getByRole("button", { name: "Preview mobile layout" }).click();
  await expect(
    page.getByRole("region", { name: "Mobile layout preview" }),
  ).toBeVisible();

  // 15. Export the concept.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("website-concept.md");

  // Safety boundary: no publishing path and no real website creation.
  await expect(
    page.getByText(
      "Concept-only rendering. No website is created, deployed, or published.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Publish/i })).toHaveCount(0);
  expect(state.proposals[0]?.origin).toBe("ai");
  expect(requests.some((request) => request.type === "generate_concept")).toBe(
    true,
  );
});
