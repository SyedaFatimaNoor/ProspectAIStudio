import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import {
  emptyWorkspace,
  type Workspace,
  type Business,
} from "../../src/lib/types";
// Test-only HTTP fixtures. These are never bundled into application code or inserted into the live database.
const id = "bf4941be-e03a-454b-905c-ae57c247e8e3";
const fixture: Business = {
  id,
  name: "TEST ONLY — Fixture Café",
  category: "cafe",
  city: "Test City",
  country: "Test Country",
  phone: "+923001234567",
  email: "fixture@example.invalid",
  website: null,
  source_url: "https://example.org/test-source",
  provider: "test",
  source_id: "test/1",
  activity_status: "verified_active",
  website_status: "manual_review",
  activity_confidence: 85,
  website_confidence: 20,
  verification_status: "Verified active",
  outreach_status: "Not contacted",
  notes: "",
  created_at: new Date().toISOString(),
  facts: {},
};
async function mocked(page: Page, patch: Partial<Workspace> = {}) {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-user", email: "test@example.invalid" },
    businesses: [structuredClone(fixture)],
    config: { database: true, discovery: true, ai: false },
    ...patch,
  };
  await page.route("**/api/workspace", (r) => r.fulfill({ json: state }));
  await page.route("**/api/actions", async (route) => {
    const v = route.request().postDataJSON();
    switch (v.type) {
      case "create_job":
        state.jobs.push({
          ...v,
          id: "job-test",
          status: "queued",
          processed: 0,
          total: 0,
          logs: ["Test fixture queued"],
          error: null,
          created_at: new Date().toISOString(),
        });
        break;
      case "save_proposal":
        state.proposals.push({
          ...v,
          id: "proposal-test",
          version: 1,
          origin: "manual",
          created_at: new Date().toISOString(),
        });
        break;
      case "save_message": {
        const m = {
          ...v,
          id: "message-test",
          status: "draft",
          lawful_basis: "",
          created_at: new Date().toISOString(),
        };
        state.messages = [m];
        await route.fulfill({ json: m });
        return;
      }
      case "approve_message":
        if (
          state.suppressions.some(
            (s) => s.contact === state.messages[0]?.recipient,
          )
        ) {
          await route.fulfill({
            status: 400,
            json: { error: "Suppressed contacts cannot be approved." },
          });
          return;
        }
        state.messages[0].status = "approved";
        break;
      case "suppress":
        state.suppressions.push({
          id: "suppression-test",
          contact: v.contact,
          reason: v.reason,
        });
        state.messages.forEach((m) => {
          if (m.recipient === v.contact) m.status = "suppressed";
        });
        break;
      case "save_notes":
        state.businesses[0].notes = v.notes;
        break;
      case "verify":
        state.runs.push({
          id: "run-test",
          business_id: v.business_id,
          status: "queued",
          evidence: [],
          explanation: "",
          created_at: new Date().toISOString(),
          error: null,
        });
        break;
      case "send_message":
        await route.fulfill({
          status: 403,
          json: { error: "Sending is disabled." },
        });
        return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  return state;
}
test("public homepage labels all illustrative data and navigates to workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Find the overlooked. See the opportunity.",
    }),
  ).toBeVisible();
  await expect(page.getByText("ILLUSTRATIVE SAMPLE DATA")).toBeVisible();
  await page.getByRole("link", { name: "Take a look inside" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await expect(
    page.getByText("You’re in read-only preview.", { exact: false }),
  ).toBeVisible();
});
test("actual server denies unauthenticated writes and exposes no private data", async ({
  request,
}) => {
  const workspace = await request.get("/api/workspace");
  expect(workspace.ok()).toBeTruthy();
  const data = await workspace.json();
  expect(data.user).toBeNull();
  expect(data.businesses).toEqual([]);
  for (const type of [
    "create_job",
    "save_proposal",
    "save_message",
    "send_message",
    "suppress",
  ]) {
    const r = await request.post("/api/actions", { data: { type } });
    expect(r.status()).toBe(401);
    expect((await r.json()).error).toMatch(/Sign in/);
  }
});
test("sign in has accessible labels and native validation", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "12");
});
test("real unconfigured discovery never reports success", async ({ page }) => {
  await page.goto("/discovery");
  await page.getByLabel("City", { exact: true }).fill("Karachi");
  await page
    .getByRole("button", { name: "Start discovery", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Sign in");
  await expect(page.getByText("Your first search starts above")).toBeVisible();
});
test("starting a discovery queues a job and shows source logs (test provider fixture)", async ({
  page,
}) => {
  await mocked(page);
  await page.goto("/discovery");
  await page.getByLabel("City", { exact: true }).fill("Test City");
  await page
    .getByRole("button", { name: "Start discovery", exact: true })
    .click();
  await expect(page.getByText("cafe in Test City, Pakistan")).toBeVisible();
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(page.getByText("Test fixture queued")).toBeVisible();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
});
test("leads search, filters, column controls, selection and CSV export", async ({
  page,
}) => {
  await mocked(page);
  await page.goto("/leads");
  await expect(
    page.getByRole("button", {
      name: "Open TEST ONLY — Fixture Café",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Search leads").fill("nothing-matches");
  await expect(
    page.getByText("No businesses match these filters"),
  ).toBeVisible();
  await page.getByLabel("Search leads").fill("");
  await page
    .getByLabel("Filter by website status")
    .selectOption("website_found");
  await expect(
    page.getByText("No businesses match these filters"),
  ).toBeVisible();
  await page.getByLabel("Filter by website status").selectOption("all");
  await page.getByLabel("Choose table columns").click();
  await page.getByText("contact", { exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Public contact" }),
  ).not.toBeVisible();
  await page.getByLabel("Select all visible leads").check();
  await expect(page.getByText("1 selected")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await dl).suggestedFilename()).toBe("prospectai-leads.csv");
});
test("lead detail shows independent confidence, evidence provenance, notes and keyboard focus", async ({
  page,
}) => {
  const state = await mocked(page);
  state.runs = [
    {
      id: "run-1",
      business_id: id,
      status: "completed",
      explanation: "Test-only evidence explanation. No real verification.",
      evidence: [
        {
          type: "Test evidence",
          detail: "A test fixture, not a public claim.",
          url: "https://example.org/test-evidence",
          timestamp: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      error: null,
    },
  ];
  await page.goto("/leads");
  await page
    .getByRole("button", { name: "Open TEST ONLY — Fixture Café", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Business activity", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Official website", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Test evidence", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Notes", exact: true }).click();
  await dialog.getByLabel("Research notes").fill("Test-only research notes.");
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status")).toContainText("Research notes saved");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("verification centre opens evidence review and queues verification", async ({
  page,
}) => {
  const state = await mocked(page, {
    businesses: [
      {
        ...fixture,
        activity_status: "unverified",
        verification_status: "Unverified",
      },
    ],
  });
  await page.goto("/verification");
  await page
    .getByRole("button", { name: "View evidence", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("No verification yet.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify evidence", exact: true })
    .click();
  expect(state.runs.length).toBe(1);
  await expect(page.getByRole("status")).toContainText("Verification queued");
});
test("creates, edits, saves and exports a fact-based proposal without an AI provider", async ({
  page,
}) => {
  await mocked(page);
  await page.goto(`/studio?lead=${id}`);
  await expect(
    page.getByRole("button", { name: "Generate with AI" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Create fact-based draft" }).click();
  await expect(page.getByLabel("Concept and proposal")).toHaveValue(
    /not built, published, or approved/,
  );
  await page.getByLabel("Proposal title").fill("Test-only tailored concept");
  await page.getByRole("button", { name: "Save proposal" }).click();
  await expect(
    page.getByRole("button", { name: /Test-only tailored concept/ }),
  ).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await dl).suggestedFilename()).toBe("website-concept.md");
});
test("unverified leads cannot generate proposals", async ({ page }) => {
  await mocked(page, {
    businesses: [{ ...fixture, activity_status: "unverified" }],
  });
  await page.goto(`/studio?lead=${id}`);
  await expect(
    page.getByRole("button", { name: "Create fact-based draft" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Generate with AI" }),
  ).toBeDisabled();
});
test("outreach requires saving, preview and approval; sends remain disabled", async ({
  page,
}) => {
  const state = await mocked(page);
  await page.goto("/outreach");
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(
    page.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByLabel("Business", { exact: true })
    .selectOption(id);
  await page
    .getByLabel("Your message")
    .fill("Test-only personalised outreach. Reply stop to opt out.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Review & approve" }).click();
  await expect(
    page.getByRole("button", { name: "Approve draft" }),
  ).toBeDisabled();
  await page
    .getByLabel("Document your lawful basis")
    .fill("Test fixture consent recorded for the QA workflow only.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve draft" }).click();
  expect(state.messages[0].status).toBe("approved");
  await expect(page.getByText("Draft-only mode")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toHaveCount(0);
});
test("opt-out records appear on suppression list", async ({ page }) => {
  const state = await mocked(page);
  await page.goto("/outreach");
  await page
    .getByRole("button", { name: "Suppression list", exact: true })
    .click();
  await page.getByLabel("Contact to suppress").fill("fixture@example.invalid");
  await page
    .getByLabel("Opt-out reason")
    .fill("Test fixture requested no further contact");
  await page.getByRole("button", { name: "Record opt-out" }).click();
  await expect(
    page.getByText("fixture@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Do not contact", { exact: true })).toBeVisible();
  expect(state.suppressions.length).toBe(1);
});
test("provider errors and timeouts are visible, not silent empty success", async ({
  page,
}) => {
  await mocked(page, {
    jobs: [
      {
        id: "job-1",
        city: "Test City",
        country: "Test",
        category: "cafe",
        max_results: 25,
        status: "failed",
        processed: 0,
        total: 0,
        error: "Provider timeout. No absence inference made.",
        logs: ["Source request timed out. Retry limit reached."],
        created_at: new Date().toISOString(),
      },
    ],
  });
  await page.goto("/discovery");
  await expect(
    page.getByText("Provider timeout. No absence inference made."),
  ).toBeVisible();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Resume job")).toBeVisible();
});
test("workspace connection failure shows actionable error", async ({
  page,
}) => {
  await page.route("**/api/workspace", (r) =>
    r.fulfill({
      status: 503,
      json: {
        ...emptyWorkspace,
        error: "Database connection failed. Check configuration.",
      },
    }),
  );
  await page.goto("/overview");
  await expect(page.getByRole("status")).toContainText(
    "Database connection failed",
  );
});
test("mobile navigation, keyboard dialog dismissal and no horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/",
    "/overview",
    "/discovery",
    "/leads",
    "/verification",
    "/studio",
    "/outreach",
    "/settings",
    "/sign-in",
  ]) {
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      path,
    ).toBeTruthy();
  }
  await page.goto("/overview");
  await page.getByLabel("Open navigation").click();
  await page.getByRole("link", { name: "Leads explorer" }).click();
  await expect(
    page.getByRole("heading", { name: "Leads explorer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Quick search" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const path of [
  "/",
  "/overview",
  "/discovery",
  "/leads",
  "/verification",
  "/studio",
  "/outreach",
  "/settings",
  "/sign-in",
]) {
  test(`WCAG AA automated accessibility: ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("cloud discovery explains scheduling, daily cap and source-only scope", async ({
  page,
}) => {
  await mocked(page, {
    config: {
      database: true,
      discovery: true,
      ai: false,
      worker: {
        enabled: true,
        mode: "listing-only",
        daily_limit: 20,
        daily_attempts: 20,
        interval_minutes: 5,
        last_started_at: null,
        last_finished_at: null,
      },
    },
  });
  await page.goto("/discovery");
  await expect(
    page.getByText(/Daily cap reached; queued jobs wait/),
  ).toBeVisible();
  await expect(
    page.getByText(
      /activity and website ownership\/absence require manual review/,
    ),
  ).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test("cloud verification never presents a listing review as a live website check", async ({
  page,
}) => {
  await mocked(page, {
    config: {
      database: true,
      discovery: true,
      ai: false,
      worker: {
        enabled: true,
        mode: "listing-only",
        daily_limit: 20,
        daily_attempts: 1,
        interval_minutes: 5,
        last_started_at: null,
        last_finished_at: null,
      },
    },
  });
  await page.goto("/verification");
  await expect(
    page.getByText(/A completed run does not mean verified activity/),
  ).toBeVisible();
});

test("paused cloud worker explains that queued jobs cannot run", async ({
  page,
}) => {
  await mocked(page, {
    config: {
      database: true,
      discovery: true,
      ai: false,
      worker: {
        enabled: false,
        mode: "listing-only",
        daily_limit: 20,
        daily_attempts: 1,
        interval_minutes: 5,
        last_started_at: null,
        last_finished_at: null,
      },
    },
  });
  await page.goto("/discovery");
  await expect(page.getByText(/Cloud discovery is paused/)).toBeVisible();
});
