import { z } from "zod";

/**
 * ProspectAI currently uses one private workspace per authenticated user; it
 * intentionally has no client-selectable workspace/organisation identifier.
 * Reject tenant-looking fields rather than silently accepting a spoofed scope.
 */
const clientTenantKeys = new Set([
  "user_id",
  "userId",
  "workspace_id",
  "workspaceId",
  "organization_id",
  "organizationId",
  "tenant_id",
  "tenantId",
]);

export function rejectClientTenantOverride(input: unknown) {
  const value = z.record(z.string(), z.unknown()).parse(input);
  for (const key of Object.keys(value)) {
    if (clientTenantKeys.has(key))
      throw new Error("Workspace scope is derived from the signed-in user.");
  }
  return value;
}
