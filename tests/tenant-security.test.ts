import test from "node:test";
import assert from "node:assert/strict";
import { rejectClientTenantOverride } from "../src/lib/tenant-security";

test("server actions reject client-supplied workspace and tenant identifiers", () => {
  for (const key of [
    "user_id",
    "userId",
    "workspace_id",
    "workspaceId",
    "organization_id",
    "tenantId",
  ]) {
    assert.throws(
      () =>
        rejectClientTenantOverride({ type: "save_notes", [key]: "spoofed" }),
      /Workspace scope is derived/,
    );
  }
  assert.deepEqual(
    rejectClientTenantOverride({ type: "save_notes", id: "lead-id" }),
    { type: "save_notes", id: "lead-id" },
  );
});
