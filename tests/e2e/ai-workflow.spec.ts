import { test, expect, type Page } from "@playwright/test";
import {
  emptyWorkspace,
  type Business,
  type Proposal,
  type Workspace,
} from "../../src/lib/types";
import {
  renderConceptMarkdown,
  selectVerifiedLeadFacts,
} from "../../src/lib/ai-schema";
import { publicVerifiedLead, validConcept } from "../ai-fixtures";

// Browser fixtures only: no production workspace or real user records are read.
const id = publicVerifiedLead.id;
const generatedAt = "2026-11-05T12:00:00.000Z";
const fixture: Business = {
  id,
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

function conceptResult(version: number, regenerated: boolean) {
  const { facts, snapshot } = selectVerifiedLeadFacts(
    publicVerifiedLead,
    () => generatedAt,
  );
  const concept = validConcept(facts);
  const meta = {
    provider: "Ollama Cloud",
    model: "gemma4:31b",
    generated_at: generatedAt,
  };
  const content = renderConceptMarkdown(facts, concept, meta);
  const proposal: Proposal = {
    id: "ai-concept-browser-fixture",
    business_id: id,
    title: `Website concept — ${publicVerifiedLead.name}`,
    content,
    version,
    origin: "ai",
    ai_provider: meta.provider,
    ai_model: meta.model,
    generated_at: meta.generated_at,
    ai_output: concept,
    facts_snapshot: snapshot,
    created_at: generatedAt,
    updated_at: generatedAt,
  };
  return {
    content,
    title: proposal.title,
    provider: meta.provider,
    model: meta.model,
    generated_at: meta.generated_at,
    concept,
    facts_snapshot: snapshot,
    regenerated,
    proposal,
  };
}

async function mocked(
  page: Page,
  options: { error?: { status: number; message: string } } = {},
) {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-only-account" },
    businesses: [structuredClone(fixture)],
    config: { database: true, discovery: false, ai: true },
  };
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/api/actions", async (route) => {
    const value = route.request().postDataJSON();
    requests.push(value);
    if (value.type === "generate_concept") {
      if (options.error)
        return route.fulfill({
          status: options.error.status,
          json: { error: options.error.message, code: "unavailable" },
        });
      const regenerated = value.regenerate === true;
      const result = conceptResult(regenerated ? 2 : 1, regenerated);
      state.proposals = [
        result.proposal,
        ...state.proposals.filter((p) => p.id !== result.proposal.id),
      ];
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return { state, requests };
}

test("AI concept is generated, saved with metadata, editable, and regenerable", async ({
  page,
}) => {
  const { requests } = await mocked(page);
  await page.goto(`/studio?lead=${id}`);
  const generate = page.getByRole("button", { name: "Generate with AI" });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Editable website copy/,
  );
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Suggested website structure/,
  );
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Visual direction/,
  );
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /Uncertain information/,
  );
  await expect(page.getByText(/Saved AI concept · revision 1/)).toBeVisible();
  await expect(page.getByText(/Ollama Cloud/).first()).toBeVisible();
  await expect(page.getByText(/gemma4:31b/).first()).toBeVisible();
  await expect(page.locator(".saved-list")).toContainText(
    "Website concept — Café nt",
  );
  await expect(page.locator(".saved-list")).toContainText("Revision 1");
  await expect(requests[0]).toMatchObject({
    type: "generate_concept",
    business_id: id,
  });

  await page.getByRole("button", { name: "Regenerate with AI" }).click();
  await expect(page.locator(".saved-list")).toContainText("Revision 2");
  await expect(page.getByText(/Saved AI concept · revision 2/)).toBeVisible();
  expect(requests).toHaveLength(2);
  await expect(requests[1]).toMatchObject({
    type: "generate_concept",
    business_id: id,
    regenerate: true,
    proposal_id: "ai-concept-browser-fixture",
  });
});

test("provider unavailability displays an inline error and saves no concept", async ({
  page,
}) => {
  const { state } = await mocked(page, {
    error: {
      status: 503,
      message:
        "TEST ONLY — Ollama could not be reached. Check the server configuration and retry. No concept was saved.",
    },
  });
  await page.goto(`/studio?lead=${id}`);
  await page.getByRole("button", { name: "Generate with AI" }).click();
  const inlineError = page
    .getByRole("alert")
    .filter({ hasText: "TEST ONLY — Ollama could not be reached" });
  await expect(inlineError).toContainText(
    "TEST ONLY — Ollama could not be reached",
  );
  await expect(inlineError).toContainText("No concept was saved");
  expect(state.proposals).toHaveLength(0);
  await expect(page.getByLabel("Concept and proposal")).toHaveCount(0);
});
