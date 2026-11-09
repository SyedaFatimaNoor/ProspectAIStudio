import { test, expect, type Page } from "@playwright/test";
import { emptyWorkspace, type Workspace } from "../../src/lib/types";
import {
  outreachBusiness,
  outreachRun,
  outreachWorkspacePatch,
  publicOutreachPhone,
} from "../outreach-fixtures";

type Harness = {
  state: Workspace;
  saveCalls: number;
  exportCalls: number;
  sendCalls: number;
  suppressionCalls: number;
};

async function mocked(
  page: Page,
  patch: Partial<Workspace> = {},
): Promise<Harness> {
  const state: Workspace = {
    ...structuredClone(emptyWorkspace),
    ...structuredClone(outreachWorkspacePatch()),
    config: { database: true, discovery: false, ai: false },
    ...patch,
  };
  const harness: Harness = {
    state,
    saveCalls: 0,
    exportCalls: 0,
    sendCalls: 0,
    suppressionCalls: 0,
  };
  function addAudit(action: string, entityId: string) {
    state.audit_logs.unshift({
      id: `audit-${state.audit_logs.length + 1}`,
      action,
      entity_id: entityId,
      detail: { workflow: "outreach", delivery: "not_attempted" },
      created_at: new Date().toISOString(),
    });
  }
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: state,
      headers: { "cache-control": "no-store" },
    }),
  );
  await page.route("**/api/actions", async (route) => {
    const v = route.request().postDataJSON();
    switch (v.type) {
      case "save_message": {
        harness.saveCalls += 1;
        const existing = state.messages.find((m) => m.id === v.id);
        const m = existing
          ? {
              ...existing,
              ...v,
              status: "draft",
            }
          : {
              ...v,
              id: "message-outreach",
              status: "draft",
              lawful_basis: "",
              created_at: new Date().toISOString(),
            };
        state.messages = existing
          ? state.messages.map((item) => (item.id === m.id ? m : item))
          : [m];
        addAudit(existing ? "Draft edited" : "Draft created", m.id);
        await route.fulfill({ json: m });
        return;
      }
      case "approve_message": {
        const m = state.messages.find((item) => item.id === v.id);
        if (!m) {
          await route.fulfill({ status: 404, json: { error: "Not found." } });
          return;
        }
        m.status = "approved";
        m.lawful_basis = v.lawful_basis;
        state.events.push({
          message_id: m.id,
          event_type: "approved",
          detail: "Human review; sending remains disabled.",
          created_at: new Date().toISOString(),
        });
        addAudit("Draft approved", m.id);
        await route.fulfill({ json: m });
        return;
      }
      case "export_outreach_draft": {
        harness.exportCalls += 1;
        const m = state.messages.find((item) => item.id === v.id);
        addAudit("Draft exported", v.id);
        await route.fulfill({
          json: { ok: true, id: v.id, status: m?.status || "draft" },
        });
        return;
      }
      case "suppress": {
        harness.suppressionCalls += 1;
        const id = "suppression-outreach";
        state.suppressions.push({
          id,
          contact: v.contact,
          reason: v.reason,
        });
        state.messages.forEach((m) => {
          if (m.recipient === v.contact) m.status = "suppressed";
        });
        addAudit("Contact suppressed", id);
        await route.fulfill({ json: { ok: true, id } });
        return;
      }
      case "send_message": {
        harness.sendCalls += 1;
        await route.fulfill({
          status: 403,
          json: {
            error:
              "Sending is disabled. No messaging provider is authorised. Approval never sends a message.",
          },
        });
        return;
      }
      case "message_event":
        state.events.push({
          message_id: v.message_id,
          event_type: v.event_type,
          detail: v.detail,
          created_at: new Date().toISOString(),
        });
        await route.fulfill({ json: { ok: true } });
        return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  return harness;
}

test("Outreach Centre completes the full draft workflow without sending", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const harness = await mocked(page);
  await page.goto("/outreach");
  await expect(
    page.getByText("Sending remains disabled.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New draft" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("outreach-eligibility")).toContainText(
    "Select a verified lead before creating an outreach draft.",
  );
  await expect(
    dialog.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();

  await dialog
    .getByLabel("Business", { exact: true })
    .selectOption(outreachBusiness.id);
  await expect(dialog.getByLabel("Recipient")).toHaveValue(publicOutreachPhone);
  await expect(dialog.getByTestId("outreach-eligibility")).toHaveCount(0);
  await dialog
    .getByLabel("Subject")
    .fill("A source-backed website idea for Café nt");
  await dialog
    .getByLabel("Your message")
    .fill("Hello Café nt team, this is a human-reviewed draft only.");
  await dialog.getByRole("button", { name: "Add personalization" }).click();
  await expect(dialog.getByLabel("Your message")).toHaveValue(
    /Personalisation: Business: Café nt/,
  );
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/draft=message-outreach/);
  expect(harness.state.messages).toHaveLength(1);
  expect(harness.state.audit_logs.map((entry) => entry.action)).toContain(
    "Draft created",
  );

  await dialog.getByLabel("Subject").fill("Reviewed website idea for Café nt");
  await dialog
    .getByLabel("Your message")
    .fill("Hello Café nt team, this saved draft was edited before review.");
  await dialog.getByRole("button", { name: "Add personalization" }).click();
  const refreshed = page.waitForResponse("**/api/workspace");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await refreshed;
  expect(harness.state.messages[0].subject).toBe(
    "Reviewed website idea for Café nt",
  );
  expect(harness.state.audit_logs.map((entry) => entry.action)).toContain(
    "Draft edited",
  );

  const reloaded = page.waitForResponse("**/api/workspace");
  await page.goto("/outreach?draft=message-outreach&reload=1", {
    waitUntil: "domcontentloaded",
  });
  await reloaded;
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByLabel("Subject")).toHaveValue(
    "Reviewed website idea for Café nt",
    { timeout: 20_000 },
  );
  await expect(dialog.getByLabel("Your message")).toHaveValue(
    /Personalisation: Business: Café nt/,
  );

  await dialog.getByRole("button", { name: "Review & approve" }).click();
  await dialog
    .getByLabel("Document your lawful basis")
    .fill("Human-reviewed test workflow; no delivery is authorised.");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Approve draft" }).click();
  expect(harness.state.messages[0].status).toBe("approved");
  expect(harness.state.audit_logs.map((entry) => entry.action)).toContain(
    "Draft approved",
  );

  await page.getByRole("tab", { name: "Approved", exact: true }).click();
  await page.locator(".message-list button").first().click();
  dialog = page.getByRole("dialog");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export draft" }).click();
  expect((await download).suggestedFilename()).toBe("outreach-draft.txt");
  expect(harness.exportCalls).toBe(1);
  expect(harness.state.audit_logs.map((entry) => entry.action)).toContain(
    "Draft exported",
  );

  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "Suppression list", exact: true })
    .click();
  await page.getByLabel("Contact to suppress").fill(publicOutreachPhone);
  await page
    .getByLabel("Opt-out reason")
    .fill("Test-only opt-out for workflow validation.");
  await page.getByRole("button", { name: "Record opt-out" }).click();
  await expect(
    page.getByText(publicOutreachPhone, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Do not contact", { exact: true })).toBeVisible();
  expect(harness.suppressionCalls).toBe(1);

  const audit = page.getByTestId("outreach-audit-log");
  for (const action of [
    "Draft created",
    "Draft edited",
    "Draft approved",
    "Draft exported",
    "Contact suppressed",
  ])
    await expect(audit).toContainText(action);

  const send = await page.evaluate(async () => {
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        id: "message-outreach",
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(send.status).toBe(403);
  expect(send.body.error).toContain("Sending is disabled");
  expect(harness.sendCalls).toBe(1);
  expect(harness.saveCalls).toBe(2);
  expect(harness.state.messages.every((m) => m.status !== "sent")).toBe(true);
  expect(harness.state.events.every((e) => e.event_type !== "sent")).toBe(true);
  await expect(page.getByRole("button", { name: /Send message/i })).toHaveCount(
    0,
  );
});

test("Outreach Centre blocks all five ineligible draft states", async ({
  page,
}) => {
  const cases = [
    {
      name: "no lead selected",
      patch: {},
      selectLead: false,
      reason: "Select a verified lead before creating an outreach draft.",
    },
    {
      name: "lead has no evidence",
      patch: {
        businesses: [
          {
            ...structuredClone(outreachBusiness),
            source_observed_at: null,
            facts: { ...outreachBusiness.facts, evidence: [] },
          },
        ],
        runs: [],
      },
      selectLead: true,
      reason:
        "Record source-backed verification evidence before creating an outreach draft.",
    },
    {
      name: "contact is suppressed",
      patch: {
        suppressions: [
          {
            id: "suppression-outreach",
            contact: publicOutreachPhone,
            reason: "Test-only opt-out for workflow validation.",
          },
        ],
      },
      selectLead: true,
      reason: "This contact is on the suppression list. Do not create a draft.",
    },
    {
      name: "contact has no public contact information",
      patch: {
        businesses: [
          { ...structuredClone(outreachBusiness), phone: null, email: null },
        ],
      },
      selectLead: true,
      reason:
        "No public contact information is available for this lead and channel.",
    },
    {
      name: "lead is still unverified",
      patch: {
        businesses: [
          {
            ...structuredClone(outreachBusiness),
            activity_status: "unverified",
            verification_status: "Unverified",
          },
        ],
      },
      selectLead: true,
      reason: "Verify business activity before creating an outreach draft.",
    },
  ];
  const harness = await mocked(page, cases[0].patch);
  for (const item of cases) {
    harness.state.businesses = item.patch.businesses
      ? structuredClone(item.patch.businesses)
      : [structuredClone(outreachBusiness)];
    harness.state.runs = item.patch.runs
      ? structuredClone(item.patch.runs)
      : [structuredClone(outreachRun)];
    harness.state.suppressions = item.patch.suppressions
      ? structuredClone(item.patch.suppressions)
      : [];
    await page.goto("/outreach");
    await page.getByRole("button", { name: "New draft" }).click();
    const dialog = page.getByRole("dialog");
    if (item.selectLead)
      await dialog
        .getByLabel("Business", { exact: true })
        .selectOption(outreachBusiness.id);
    await expect(dialog.getByTestId("outreach-eligibility")).toContainText(
      item.reason,
    );
    await expect(
      dialog.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
  }
  expect(harness.saveCalls).toBe(0);
  expect(harness.exportCalls).toBe(0);
  expect(harness.sendCalls).toBe(0);
  expect(harness.state.messages).toHaveLength(0);
});
