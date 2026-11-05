import {
  discoveryAvailability,
  safeOperationalMessage,
} from "./discovery-availability";
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

export function discoveryJobErrorMessage(error: string) {
  const legacy406 =
    "OpenStreetMap provider returned HTTP 406. Respect endpoint rate limits and retry later.";
  if (error.includes(legacy406))
    return safeOperationalMessage(
      error.replace(
        legacy406,
        "OpenStreetMap provider returned HTTP 406. The endpoint rejected this request; automatic retries are paused pending operator review of provider policy/configuration.",
      ),
    );
  return safeOperationalMessage(error);
}

export function discoveryBlockReason(
  data: Workspace,
  loading = false,
  connectionError: string | null = null,
) {
  const availability = discoveryAvailability(data, loading, connectionError);
  return availability.available ? null : availability.reason;
}
