import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emptyWorkspace, type Workspace } from "../../src/lib/types";

// HTTP fixtures only: never written to production or represented as real leads.
async function workspace(page: Page, patch: Partial<Workspace> = {}) {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-only-account", email: "fixture@example.invalid" },
    config: { database: true, discovery: true, ai: false },
    ...patch,
  };
  await page.route("**/api/workspace", (r) => r.fulfill({ json: state }));
  return state;
}
const start = (page: Page) =>
  page.getByRole("button", { name: "Start discovery", exact: true });
const city = (page: Page) =>
  page.getByRole("textbox", { name: "City", exact: true });
const maximum = (page: Page) =>
  page.getByRole("spinbutton", { name: "Maximum results" });

function recordJob(state: Workspace, body: Record<string, unknown>) {
  state.jobs.push({
    id: "test-only-job",
    city: String(body.city),
    country: String(body.country),
    category: String(body.category),
    max_results: Number(body.max_results),
    status: "queued",
    processed: 0,
    total: 0,
    error: null,
    logs: ["TEST FIXTURE — queued only; no provider queried"],
    created_at: new Date().toISOString(),
  });
}

test("discovery gives inline field errors, correct descriptions and first-invalid focus without making a request", async ({
  page,
}) => {
  await workspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let actions = 0;
  await page.route("**/api/actions", (r) => {
    actions++;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/discovery");
  await expect(city(page)).not.toHaveAttribute("aria-invalid", "true");
  await start(page).click();
  await expect(city(page)).toBeFocused();
  await expect(city(page)).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Please enter a city.", { exact: true }),
  ).toBeVisible();
  const described = (await city(page).getAttribute("aria-describedby"))!;
  expect(await page.locator(`[id="${described}"]`).innerText()).toBe(
    "Please enter a city.",
  );
  await page.getByRole("textbox", { name: "Country", exact: true }).fill("   ");
  await city(page).fill("   ");
  await start(page).click();
  await expect(
    page.getByRole("textbox", { name: "Country", exact: true }),
  ).toBeFocused();
  expect(actions).toBe(0);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test("configured result limits, empty/decimal/out-of-range values, trimmed payload, loading and queued-only success", async ({
  page,
}) => {
  const state = await workspace(page, {
    settings: {
      search_limit: 8,
      verification_threshold: 75,
      retention_days: 90,
    },
  });
  let actions = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/actions", async (route) => {
    actions++;
    const body = route.request().postDataJSON();
    expect(body.city).toBe("Karachi");
    expect(body.max_results).toBe(5);
    await gate;
    recordJob(state, body);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/discovery");
  await expect(maximum(page)).toHaveValue("8");
  await expect(maximum(page)).toHaveAttribute("max", "8");
  await city(page).fill(" Karachi ");
  for (const value of ["", "0", "101", "2.5", "9"]) {
    await maximum(page).fill(value);
    await start(page).click();
    await expect(maximum(page)).toBeFocused();
    await expect(maximum(page)).toHaveAttribute("aria-invalid", "true");
    expect(actions).toBe(0);
  }
  await expect(
    page.getByText(/Your workspace limit is 8 results/),
  ).toBeVisible();
  const ids = (await maximum(page).getAttribute("aria-describedby"))!.split(
    " ",
  );
  expect(ids).toHaveLength(2); // Both the hint and the error survive Field cloning.
  await maximum(page).fill("5");
  await expect(maximum(page)).not.toHaveAttribute("aria-invalid", "true");
  await start(page).click();
  await expect(
    page.getByRole("button", { name: "Queuing discovery…", exact: true }),
  ).toBeDisabled();
  await page.locator("form.form-stack").dispatchEvent("submit");
  expect(actions).toBe(1);
  release();
  await expect(page.getByRole("status")).toContainText(
    "Queued is not a completed search",
  );
  await expect(
    page.getByText("cafe in Karachi, Pakistan", { exact: true }),
  ).toBeVisible();
  expect(state.businesses).toHaveLength(0);
});

for (const mode of ["preview", "source-missing", "paused"] as const) {
  test(`discovery prerequisite feedback prevents a pointless request: ${mode}`, async ({
    page,
  }) => {
    const state = await workspace(page);
    if (mode === "preview") state.user = null;
    if (mode === "source-missing") state.config.discovery = false;
    if (mode === "paused")
      state.config.worker = {
        enabled: false,
        mode: "listing-only",
        daily_limit: 20,
        daily_attempts: 1,
        interval_minutes: 5,
        last_started_at: null,
        last_finished_at: null,
      };
    let actions = 0;
    await page.route("**/api/actions", (r) => {
      actions++;
      return r.fulfill({ json: { ok: true } });
    });
    await page.goto("/discovery");
    await expect(page.getByText("Loading workspace requirements…")).toHaveCount(
      0,
    );
    await city(page).fill("Karachi");
    await expect(start(page)).toBeDisabled();
    await expect(start(page)).toHaveAttribute(
      "aria-describedby",
      "discovery-unavailable",
    );
    await page.locator("form.form-stack").dispatchEvent("submit");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      mode === "preview"
        ? "Sign in to queue"
        : mode === "paused"
          ? "Discovery is temporarily unavailable because the source worker is paused"
          : "No discovery source is configured",
    );
    expect(actions).toBe(0);
    await expect(
      page.getByText("Your first search starts above"),
    ).toBeVisible();
  });
}

test("a paused worker labels existing queued work as blocked and prevents a resume control", async ({
  page,
}) => {
  const state = await workspace(page);
  state.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: null,
  };
  state.jobs = [
    {
      id: "test-only-queued-job",
      country: "Pakistan",
      city: "Karachi",
      category: "cafe",
      max_results: 1,
      status: "queued",
      processed: 0,
      total: 0,
      error: null,
      logs: ["TEST FIXTURE — job was queued before the worker pause"],
      created_at: new Date().toISOString(),
    },
  ];
  await page.goto("/discovery");
  const job = page.locator(".job-card");
  await expect(job).toContainText("Blocked — worker unavailable");
  await expect(job).toContainText("This job has not been sent to the provider");
  await expect(job.getByRole("button", { name: "Pause job" })).toHaveCount(0);
  await expect(job.getByRole("button", { name: "Resume job" })).toHaveCount(0);
});

test("a blocked historical provider rejection is not mislabeled as rate limiting", async ({
  page,
}) => {
  const state = await workspace(page);
  state.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: null,
  };
  state.jobs = [
    {
      id: "test-only-rejected-job",
      country: "Pakistan",
      city: "Karachi",
      category: "cafe",
      max_results: 1,
      status: "queued",
      processed: 0,
      total: 0,
      error:
        "OpenStreetMap provider returned HTTP 406. Respect endpoint rate limits and retry later.",
      logs: ["TEST FIXTURE — previous provider rejection"],
      created_at: new Date().toISOString(),
    },
  ];
  await page.goto("/discovery");
  const job = page.locator(".job-card");
  await expect(job).toContainText("A prior provider attempt failed");
  await expect(job).toContainText("The endpoint rejected this request");
  await expect(job).not.toContainText("Respect endpoint rate limits");
});

test("settings separates preview configuration from worker scheduling and makes refresh scope explicit", async ({
  page,
}) => {
  const state = await workspace(page);
  state.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: "2026-10-27T08:15:00.000Z",
  };
  await page.goto("/settings");
  const card = page
    .locator(".integration-card")
    .filter({ has: page.getByRole("heading", { name: "OpenStreetMap" }) });
  await expect(card).toContainText("Worker paused");
  await expect(card).toContainText("Reachability");
  await expect(card).toContainText("Not tested — no provider request was made");
  await expect(card).toContainText("Paused — new discovery jobs are blocked");
  await page
    .getByRole("button", { name: "Refresh workspace status", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "This reads saved configuration and worker state; it does not probe external providers.",
  );
});

test("server rejection stays inline, preserves input and permits an explicit retry without claiming source success", async ({
  page,
}) => {
  const state = await workspace(page);
  let actions = 0;
  await page.route("**/api/actions", async (route) => {
    actions++;
    if (actions === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: "TEST FIXTURE — queue service unavailable. No job saved.",
        },
      });
    recordJob(state, route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/discovery");
  await city(page).fill("Karachi");
  await start(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No job saved",
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No job saved",
  );
  await expect(city(page)).toHaveValue("Karachi");
  await expect(start(page)).toBeEnabled();
  expect(state.jobs).toHaveLength(0);
  await start(page).click();
  await expect(page.getByRole("status")).toContainText("Discovery queued");
  expect(actions).toBe(2);
  expect(state.jobs).toHaveLength(1);
});

test("every main workspace route offers consistent preview guidance, no invented data and a sign-in destination", async ({
  page,
}) => {
  await workspace(page, { user: null });
  for (const path of [
    "/overview",
    "/discovery",
    "/leads",
    "/verification",
    "/studio",
    "/outreach",
    "/settings",
  ]) {
    await page.goto(path);
    const guide = page.locator("details.workspace-onboarding");
    await expect(guide).toBeVisible();
    if (path !== "/overview") await guide.locator("summary").click();
    await expect(guide).toContainText("Read-only preview");
    await expect(guide).toContainText("AI is optional");
    await expect(guide).toContainText("illustrative—not discovered businesses");
    await expect(
      guide.getByRole("link", { name: "Sign in to save research" }),
    ).toHaveAttribute("href", "/sign-in");
  }
});

test("first-run setup reflects paused/unknown workers honestly and remains accessible on mobile", async ({
  page,
}) => {
  const state = await workspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/overview");
  const guide = page.locator("details.workspace-onboarding");
  await expect(guide).toContainText("worker status unconfirmed");
  await expect(
    guide.getByRole("link", { name: "Open discovery", exact: true }),
  ).toHaveAttribute("href", "/discovery");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  state.config.worker = {
    enabled: false,
    mode: "listing-only",
    daily_limit: 20,
    daily_attempts: 1,
    interval_minutes: 5,
    last_started_at: null,
    last_finished_at: null,
  };
  await page.reload();
  await expect(guide).toContainText("Cloud worker paused");
  await expect(
    guide.getByRole("link", { name: "View setup instructions" }),
  ).toHaveAttribute("href", "/settings");
});

test("connection failure is not misrepresented as signed-out preview and can be retried", async ({
  page,
}) => {
  const state = {
    ...structuredClone(emptyWorkspace),
    user: { id: "test-only-account" },
    config: { database: true, discovery: false, ai: false },
  };
  let tries = 0;
  await page.route("**/api/workspace", (route) => {
    tries++;
    return tries === 1
      ? route.fulfill({
          status: 503,
          json: {
            ...emptyWorkspace,
            error: "TEST FIXTURE — database unavailable",
          },
        })
      : route.fulfill({ json: state });
  });
  await page.goto("/overview");
  const error = page.getByRole("complementary", {
    name: "Workspace connection",
    exact: true,
  });
  await expect(error).toContainText(
    "account and setup status cannot be confirmed",
  );
  await expect(page.locator("details.workspace-onboarding")).toHaveCount(0);
  await expect(page.locator(".workspace-switch small")).toHaveText(
    "Connection unconfirmed",
  );
  await expect(page.getByText(/You’re in read-only preview/)).toHaveCount(0);
  await error.getByRole("button", { name: "Retry connection" }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator("details.workspace-onboarding")).toContainText(
    "Authenticated account",
  );
  expect(tries).toBe(2);
});

test("failed refresh preserves the last account/form but prevents a stale discovery request", async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto("/discovery");
  await expect(page.locator(".workspace-switch small")).toHaveText(
    "Personal workspace",
  );
  await city(page).fill("Karachi");
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 503,
      json: { ...emptyWorkspace, error: "TEST FIXTURE — refresh failed" },
    }),
  );
  let actions = 0;
  await page.route("**/api/actions", (route) => {
    actions++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "Refresh jobs", exact: true }).click();
  await expect(
    page.getByRole("complementary", {
      name: "Workspace connection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".workspace-switch small")).toHaveText(
    "Connection unconfirmed",
  );
  await expect(city(page)).toHaveValue("Karachi");
  await expect(page.locator(".profile strong")).toHaveText("fixture");
  await expect(start(page)).toBeDisabled();
  await page.locator("form.form-stack").dispatchEvent("submit");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Workspace connection failed",
  );
  expect(actions).toBe(0);
  expect(state.user).not.toBeNull();
});
