import type { SupabaseClient } from "@supabase/supabase-js";
import {
  discoverySourceConfigured,
  extractPathConfigured,
  snapshotEnabled,
} from "./discovery";
import { overpassRequestHeaders } from "./discovery-core";

export const healthProviderSchema = [
  "database",
  "discovery",
  "worker",
] as const;
export type HealthProvider = (typeof healthProviderSchema)[number];
export type ProviderHealthStatus =
  | "reachable"
  | "paused"
  | "blocked"
  | "not_configured"
  | "not_applicable"
  | "unreachable"
  | "rate_limited";

export type ProviderHealth = {
  provider: HealthProvider | "ai";
  status: ProviderHealthStatus | "reachable";
  checked_at: string;
  last_success_at: string | null;
  latency_ms: number | null;
  last_error: string | null;
  recommended_action: string;
};

type WorkerStatus = {
  enabled?: boolean;
  last_finished_at?: string | null;
  last_successful_at?: string | null;
  last_error?: string | null;
};

function completed(
  provider: HealthProvider,
  started: number,
  status: ProviderHealthStatus,
  details: Omit<
    ProviderHealth,
    "provider" | "status" | "checked_at" | "latency_ms"
  >,
): ProviderHealth {
  return {
    provider,
    status,
    checked_at: new Date().toISOString(),
    latency_ms: Math.max(0, Math.round(performance.now() - started)),
    ...details,
  };
}

function sourceHealthStatus(status: number): ProviderHealthStatus {
  if (status === 429) return "rate_limited";
  if ([400, 401, 403, 404, 405, 406, 410, 422].includes(status))
    return "blocked";
  return "unreachable";
}

/**
 * Executes only an explicit, operator-triggered health request. It never queues
 * a job, creates a lead, enables a worker, rotates endpoints, or uses a
 * user-supplied URL. The Overpass probe is a zero-area bounded query so it does
 * not retrieve businesses.
 */
export async function checkProviderHealth(
  provider: HealthProvider,
  db: SupabaseClient,
): Promise<ProviderHealth> {
  const started = performance.now();
  if (provider === "database") {
    const { error } = await db.from("pa_profiles").select("id").limit(1);
    if (error)
      return completed(provider, started, "unreachable", {
        last_success_at: null,
        last_error: `Database check failed: ${error.message}`.slice(0, 500),
        recommended_action:
          "Check Supabase project health, authenticated database access, and row-level security.",
      });
    return completed(provider, started, "reachable", {
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "No action needed. Continue monitoring project health.",
    });
  }

  if (provider === "worker") {
    const { data, error } = await db.rpc("pa_cloud_worker_status");
    if (error)
      return completed(provider, started, "unreachable", {
        last_success_at: null,
        last_error: `Worker status could not be read: ${error.message}`.slice(
          0,
          500,
        ),
        recommended_action:
          "Apply the worker status migration and check the scheduler/database connection.",
      });
    const worker = (data || {}) as WorkerStatus;
    if (worker.enabled === false)
      return completed(provider, started, "paused", {
        last_success_at: worker.last_successful_at || null,
        last_error: worker.last_error || "Worker scheduling is paused.",
        recommended_action:
          "Keep the scheduler paused until a permitted source is configured and one bounded real validation succeeds.",
      });
    return completed(provider, started, "reachable", {
      last_success_at:
        worker.last_successful_at || worker.last_finished_at || null,
      last_error: worker.last_error || null,
      recommended_action:
        "Scheduler status is available. Inspect a bounded job log to establish actual source success.",
    });
  }

  if (!discoverySourceConfigured())
    return completed(provider, started, "not_configured", {
      last_success_at: null,
      last_error: "No permitted discovery source is configured.",
      recommended_action:
        "Configure a reviewed source or load an attributed OSM snapshot; do not enable the worker solely to clear this status.",
    });

  if (snapshotEnabled()) {
    const { data, error } = await db.rpc("pa_osm_snapshot_status");
    const snapshot = data as { businesses?: number; places?: number } | null;
    if (error)
      return completed(provider, started, "unreachable", {
        last_success_at: null,
        last_error: `Snapshot status could not be read: ${error.message}`.slice(
          0,
          500,
        ),
        recommended_action:
          "Apply the snapshot migration and verify its authenticated status RPC.",
      });
    if (!snapshot?.businesses || !snapshot.places)
      return completed(provider, started, "blocked", {
        last_success_at: null,
        last_error:
          "The OSM snapshot is installed but contains no searchable places or businesses.",
        recommended_action:
          "Load a lawful, attributed extract locally, then validate one bounded search while scheduling remains paused.",
      });
    return completed(provider, started, "reachable", {
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "Snapshot is readable. Validate one bounded search and attribution before enabling scheduling.",
    });
  }

  if (extractPathConfigured())
    return completed(provider, started, "not_applicable", {
      last_success_at: null,
      last_error: null,
      recommended_action:
        "A local extract is configured. Run its worker on the host that can read the extract; hosted health checks cannot inspect that file.",
    });

  const endpoint = process.env.OVERPASS_URL?.trim();
  if (!endpoint)
    return completed(provider, started, "not_configured", {
      last_success_at: null,
      last_error:
        "No Overpass endpoint is available to the application server.",
      recommended_action:
        "Set only an endpoint whose policy explicitly permits this bounded workload, or use the snapshot path.",
    });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: overpassRequestHeaders(),
      body: new URLSearchParams({
        data: "[out:json][timeout:8];node(0,0,0,0);out 1;",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
      return completed(provider, started, sourceHealthStatus(response.status), {
        last_success_at: null,
        last_error: `OpenStreetMap provider returned HTTP ${response.status}.`,
        recommended_action:
          response.status === 429
            ? "Wait for the provider's stated retry window; do not rotate endpoints to evade a limit."
            : "Review the provider policy/configuration. Keep scheduling paused until the source explicitly accepts this workload.",
      });
    const payload = (await response.json()) as { elements?: unknown };
    if (!Array.isArray(payload.elements))
      return completed(provider, started, "unreachable", {
        last_success_at: null,
        last_error:
          "OpenStreetMap provider returned an invalid health response.",
        recommended_action:
          "Check the configured endpoint response format before scheduling work.",
      });
    return completed(provider, started, "reachable", {
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "The bounded probe succeeded. Keep normal job caps, attribution, and retries in place.",
    });
  } catch (cause) {
    const timeout =
      cause instanceof DOMException && cause.name === "TimeoutError";
    return completed(provider, started, "unreachable", {
      last_success_at: null,
      last_error: timeout
        ? "OpenStreetMap provider health check timed out."
        : "OpenStreetMap provider could not be reached.",
      recommended_action:
        "Check the permitted endpoint, network access, and provider status. Do not report an empty search as success.",
    });
  }
}
