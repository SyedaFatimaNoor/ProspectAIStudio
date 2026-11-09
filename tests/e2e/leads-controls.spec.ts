import { test, expect, type Page } from "@playwright/test";
import {
  emptyWorkspace,
  type Business,
  type Workspace,
} from "../../src/lib/types";

const makeLead = (index: number, patch: Partial<Business> = {}): Business => ({
  id: `test-lead-${index}`,
  name: `TEST ONLY — Discovery lead ${String(index).padStart(2, "0")}`,
  category: index % 2 ? "cafe" : "dental",
  city: index % 2 ? "Karachi" : "Lahore",
  country: index % 3 ? "Pakistan" : "United Arab Emirates",
  phone: null,
  email: null,
  website: null,
  source_url: `https://example.invalid/source/${index}`,
  source_observed_at: `2026-11-${String(Math.min(28, index + 1)).padStart(2, "0")}T10:00:00.000Z`,
  provider: "test-discovery",
  source_id: `test/${index}`,
  activity_status: "unverified",
  website_status: index % 2 ? "website_found" : "manual_review",
  activity_confidence: index,
  website_confidence: 20,
  verification_status: "Unverified",
  outreach_status: "Not contacted",
  notes: "",
  created_at: `2026-11-${String(Math.min(28, index + 1)).padStart(2, "0")}T10:00:00.000Z`,
  facts: {},
  ...patch,
});

async function workspace(page: Page, businesses: Business[]) {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-user" },
    businesses,
    config: { database: true, discovery: true, ai: false },
  };
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/api/actions", (route) => {
    const value = route.request().postDataJSON();
    if (value.type === "save_notes")
      state.businesses.find((lead) => lead.id === value.id)!.notes =
        value.notes;
    if (value.type === "delete_leads")
      state.businesses = state.businesses.filter(
        (lead) => !value.ids.includes(lead.id),
      );
    return route.fulfill({ json: { ok: true } });
  });
}

test("all Leads Explorer controls operate on source-backed discovery test leads", async ({
  page,
}) => {
  const leads = Array.from({ length: 11 }, (_, index) => makeLead(index + 1));
  leads[0].duplicate_group_id = "test-duplicate-group";
  leads[0].duplicate_review_status = "manual_review";
  leads[0].duplicate_match_reason = "normalized_phone";
  await workspace(page, leads);
  await page.goto("/leads");
  await expect(
    page.getByText("source-backed possible duplicate", { exact: false }),
  ).toBeVisible();
  const search = page.getByLabel("Search leads");
  await search.fill("Discovery lead 01");
  await expect(
    page.getByRole("button", { name: /Open TEST ONLY — Discovery lead 01/ }),
  ).toBeVisible();
  await search.fill("Lahore");
  await expect(page.getByText("TEST ONLY — Discovery lead 02")).toBeVisible();
  await search.fill("United Arab Emirates");
  await expect(page.getByText("TEST ONLY — Discovery lead 03")).toBeVisible();
  await search.fill("");
  await page
    .getByLabel("Filter by website status")
    .selectOption("website_found");
  await expect(page.getByText("TEST ONLY — Discovery lead 01")).toBeVisible();
  await page.getByLabel("Filter by website status").selectOption("all");
  await page.getByLabel("Filter by category").selectOption("dental");
  await expect(page.getByText("TEST ONLY — Discovery lead 02")).toBeVisible();
  await page.getByLabel("Filter by category").selectOption("all");
  await page.getByLabel("Sort leads").selectOption("name");
  await expect(page.locator("tbody tr").nth(0)).toContainText(
    "Discovery lead 01",
  );
  await page.getByLabel("Sort leads").selectOption("confidence");
  await expect(page.locator("tbody tr").nth(0)).toContainText(
    "Discovery lead 11",
  );
  await page.getByLabel("Sort leads").selectOption("newest");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByLabel("Choose table columns").click();
  await page.getByText("contact", { exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Public contact" }),
  ).not.toBeVisible();
  await page.getByLabel("Choose table columns").click();
  await page.getByRole("button", { name: "Previous page" }).click();
  await page
    .getByRole("button", { name: /Open TEST ONLY — Discovery lead 11/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("source observed", { exact: false }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: /test-discovery/ }),
  ).toHaveAttribute("href", /example\.invalid\/source\/11/);
  await dialog.getByRole("tab", { name: "Notes" }).click();
  await dialog.getByLabel("Research notes").fill("Saved test review note.");
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status")).toContainText("Research notes saved");
  await dialog.getByRole("button", { name: "Delete lead" }).click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(dialog).not.toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("prospectai-leads.csv");
});

test("Leads Explorer has explicit empty, loading and error states", async ({
  page,
}) => {
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ status: 503, json: { error: "Test workspace error" } }),
  );
  await page.goto("/leads");
  await expect(page.getByText("Loading your workspace…")).toBeVisible();
  await expect(
    page.getByText("Leads could not be loaded: Test workspace error"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});
