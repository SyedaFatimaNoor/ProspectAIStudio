import { pausedCloudWorkerMessage, workerIsKnownPaused } from "./cloud-worker";
import { jobSchema } from "./validation";
import type { Workspace } from "./types";

export function discoveryResultLimit(limit?: number) {
  return typeof limit === "number" &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 100
    ? limit
    : 100;
}

// Uses the same strict schema as the protected API. Form strings are converted
// at the UI boundary, not coerced on the server (where booleans must stay invalid).
export function validateDiscoveryForm(input: unknown, limit = 100) {
  const parsed = jobSchema.safeParse(input);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] ??= issue.message;
    }
    return { success: false as const, errors };
  }
  if (parsed.data.max_results > discoveryResultLimit(limit)) {
    errors.max_results = `Your workspace limit is ${discoveryResultLimit(limit)} results per job. Lower this value or review Settings.`;
    return { success: false as const, errors };
  }
  return { success: true as const, data: parsed.data, errors };
}

export function discoveryBlockReason(
  data: Workspace,
  loading = false,
  connectionError: string | null = null,
) {
  if (loading)
    return "Your workspace is still loading. Please try again once it is ready.";
  if (connectionError || data.error)
    return "Workspace connection failed. Refresh jobs and check the connection before trying again.";
  if (!data.user)
    return "Sign in to queue a search. Read-only preview does not save changes or run discovery.";
  if (!data.config.database)
    return "Database setup is required to save discovery jobs. View setup instructions in Settings.";
  if (!data.config.discovery)
    return "No discovery source is configured. Ask the operator to configure a permitted source in Settings. No search was run.";
  if (workerIsKnownPaused(data.config.worker)) return pausedCloudWorkerMessage;
  // A missing status is not proof that a separately configured worker is down.
  // Allow queuing, but explain the uncertainty instead of claiming live readiness.
  return null;
}
