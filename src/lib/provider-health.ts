import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderHealthRecord } from "./types";
import {
  discoverySourceConfigured,
  extractPathConfigured,
  snapshotEnabled,
} from "./discovery";
import {
  OverpassProviderError,
  categoryForStatus,
  logOverpassDiagnostic,
  overpassEndpointUrl,
  overpassHealthTimeoutMs,
  overpassRequestInit,
  overpassRequestLog,
  readBoundedProviderResponse,
  type OverpassErrorCategory,
} from "./overpass-request";

export const healthProviderSchema = [
  "database",
  "discovery",
  "worker",
] as const;
export type HealthProvider = (typeof healthProviderSchema)[number];

/** Required operator-facing states; legacy values remain readable in old rows. */
export type ProviderHealthStatus =
  | "not_configured"
  | "checking"
  | "reachable"
  | "blocked"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "unavailable";

export type ProviderHealth = Omit<
  ProviderHealthRecord,
  "provider" | "status"
> & {
  provider: HealthProvider | "ai";
  status: ProviderHealthStatus | ProviderHealthRecord["status"];
};

type WorkerStatus = {
  enabled?: boolean;
  last_finished_at?: string | null;
  last_successful_at?: string | null;
  last_error?: string | null;
};

type HealthDetails = Partial<
  Omit<
    ProviderHealth,
    | "provider"
    | "status"
    | "checked_at"
    | "requested_at"
    | "latency_ms"
    | "response_time_ms"
    | "last_failed_at"
  >
> & {
  last_success_at: string | null;
  last_error: string | null;
  recommended_action: string;
};

/** Builds one bounded persisted observation; no provider response is stored. */
function completed(
  provider: HealthProvider,
  wallStarted: number,
  perfStarted: number,
  status: ProviderHealth["status"],
  details: HealthDetails,
): ProviderHealth {
  const checkedAt = new Date().toISOString();
  const latency = Math.max(
    0,
    Math.round(performance.now() - perfStarted),
  );
  const failed =
    status !== "reachable" && status !== "not_configured" && status !== "checking";
  return {
    provider,
    status,
    ...details,
    checked_at: checkedAt,
    requested_at: new Date(wallStarted).toISOString(),
    last_failed_at: failed ? checkedAt : null,
    latency_ms: latency,
    response_time_ms: latency,
  } as ProviderHealth;
}

function statusForHttp(
  status: number,
  category: OverpassErrorCategory,
): ProviderHealth["status"] {
  if (
    status === 406 ||
    category === "provider_not_acceptable" ||
    category === "provider_policy_blocked" ||
    [400, 401, 403, 404, 405, 410, 422].includes(status)
  )
    return "blocked";
  if (status === 429 || category === "provider_rate_limited")
    return "rate_limited";
  if (status === 408 || category === "provider_timeout") return "timeout";
  if (
    category === "provider_invalid_response" ||
    category === "provider_empty_response"
  )
    return "invalid_response";
  if (status >= 500 || category === "provider_server_error")
    return "unavailable";
  return "unavailable";
}

function statusForFailure(cause: unknown): ProviderHealth["status"] {
  if (cause instanceof DOMException && cause.name === "TimeoutError")
    return "timeout";
  if (
    cause &&
    typeof cause === "object" &&
    "category" in cause &&
    (cause as { category?: string }).category === "provider_timeout"
  )
    return "timeout";
  return "unavailable";
}

/**
 * Executes only an explicit, operator-triggered health request. It never queues
 * a job, creates a lead, modifies the OSM snapshot, enables a worker, rotates
 * endpoints, or uses a client-supplied URL. The Overpass probe is a zero-area
 * `out 1` query with a strict timeout, so it does not retrieve businesses.
 */
export async function checkProviderHealth(
  provider: HealthProvider,
  db: SupabaseClient,
): Promise<ProviderHealth> {
  const wallStarted = Date.now();
  const perfStarted = performance.now();
  const configured = discoverySourceConfigured();

  if (provider === "database") {
    const { error } = await db.from("pa_profiles").select("id").limit(1);
    if (error)
      return completed(provider, wallStarted, perfStarted, "unavailable", {
        last_success_at: null,
        last_error: `Database check failed: ${error.message}`.slice(0, 500),
        recommended_action:
          "Check Supabase project health, authenticated database access, and row-level security.",
        provider_configured: true,
      });
    return completed(provider, wallStarted, perfStarted, "reachable", {
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "No action needed. Continue monitoring project health.",
      provider_configured: true,
      response_valid: true,
    });
  }

  if (provider === "worker") {
    const { data, error } = await db.rpc("pa_cloud_worker_status");
    if (error)
      return completed(provider, wallStarted, perfStarted, "unavailable", {
        last_success_at: null,
        last_error: `Worker status could not be read: ${error.message}`.slice(
          0,
          500,
        ),
        recommended_action:
          "Apply the worker status migration and check the scheduler/database connection.",
        provider_configured: true,
      });
    const worker = (data || {}) as WorkerStatus;
    if (worker.enabled === false)
      return completed(provider, wallStarted, perfStarted, "unavailable", {
        last_success_at: worker.last_successful_at || null,
        last_error: worker.last_error || "Worker scheduling is paused.",
        recommended_action:
          "Keep the scheduler paused until a permitted source is configured and one bounded real validation succeeds.",
        provider_configured: true,
        response_valid: true,
      });
    return completed(provider, wallStarted, perfStarted, "reachable", {
      last_success_at:
        worker.last_successful_at || worker.last_finished_at || null,
      last_error: worker.last_error || null,
      recommended_action:
        "Scheduler status is available. Inspect a bounded job log to establish actual source success.",
      provider_configured: true,
      response_valid: true,
    });
  }

  if (!configured)
    return completed(provider, wallStarted, perfStarted, "not_configured", {
      last_success_at: null,
      last_error: "No permitted discovery source is configured.",
      recommended_action:
        "Configure a reviewed source or load an attributed OSM snapshot; do not enable the worker solely to clear this status.",
      provider_configured: false,
    });

  if (snapshotEnabled()) {
    const { data, error } = await db.rpc("pa_osm_snapshot_status");
    const snapshot = data as { businesses?: number; places?: number } | null;
    if (error)
      return completed(provider, wallStarted, perfStarted, "unavailable", {
        last_success_at: null,
        last_error: `Snapshot status could not be read: ${error.message}`.slice(
          0,
          500,
        ),
        recommended_action:
          "Apply the snapshot migration and verify its authenticated status RPC.",
        provider_configured: true,
      });
    const valid = Boolean(snapshot?.businesses && snapshot?.places);
    if (!valid)
      return completed(provider, wallStarted, perfStarted, "blocked", {
        last_success_at: null,
        last_error:
          "The OSM snapshot is installed but contains no searchable places or businesses.",
        recommended_action:
          "Load a lawful, attributed extract locally, then validate one bounded search while scheduling remains paused.",
        provider_configured: true,
        response_valid: false,
      });
    return completed(provider, wallStarted, perfStarted, "reachable", {
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "Snapshot is readable. Validate one bounded search and attribution before enabling scheduling. The worker remains paused.",
      provider_configured: true,
      provider_hostname: "workspace-database",
      response_valid: true,
    });
  }

  if (extractPathConfigured())
    return completed(provider, wallStarted, perfStarted, "not_configured", {
      last_success_at: null,
      last_error: null,
      recommended_action:
        "A local extract is configured. Run its worker on the host that can read the extract; hosted health checks cannot inspect that file.",
      provider_configured: true,
    });

  const endpoint = process.env.OVERPASS_URL?.trim();
  if (!endpoint)
    return completed(provider, wallStarted, perfStarted, "not_configured", {
      last_success_at: null,
      last_error:
        "No Overpass endpoint is available to the application server.",
      recommended_action:
        "Set only an endpoint whose policy explicitly permits this bounded workload, or use the snapshot path.",
      provider_configured: false,
    });

  const requestId = crypto.randomUUID();
  const diagnosticStarted = performance.now();
  const method = "GET" as const;
  const query = "[out:json][timeout:5];node(0,0,0,0);out 1;";
  const record = (
    url: URL,
    status: number | null,
    category: OverpassErrorCategory,
    details: {
      contentType?: string | null;
      bodyLength?: number;
      excerpt?: string;
      includeBodyExcerpt?: boolean;
    } = {},
  ) =>
    logOverpassDiagnostic(
      overpassRequestLog({
        url,
        method,
        requestId,
        started: diagnosticStarted,
        status,
        category,
        ...details,
      }),
    );

  let url: URL;
  try {
    url = overpassEndpointUrl(endpoint, query, method);
  } catch (cause) {
    return completed(provider, wallStarted, perfStarted, "unavailable", {
      last_success_at: null,
      last_error: "Invalid permitted Overpass endpoint configuration.",
      recommended_action:
        "Set a credential-free HTTPS interpreter URL whose policy permits this bounded workload.",
      provider_configured: true,
      provider_hostname: null,
      http_status: null,
      response_valid: false,
    });
  }

  const hostname = url.hostname;
  const common = {
    provider_configured: true,
    provider_hostname: hostname,
  } as const;

  try {
    const response = await fetch(
      url,
      overpassRequestInit(
        method,
        query,
        AbortSignal.timeout(overpassHealthTimeoutMs),
      ),
    );
    const bounded = await readBoundedProviderResponse(response);
    const details = {
      contentType: bounded.contentType,
      bodyLength: bounded.length,
      excerpt: bounded.excerpt,
    };
    if (!response.ok) {
      const category = categoryForStatus(response.status, bounded.excerpt);
      record(url, response.status, category, {
        ...details,
        includeBodyExcerpt: true,
      });
      const status = statusForHttp(response.status, category);
      return completed(provider, wallStarted, perfStarted, status, {
        ...common,
        last_success_at: null,
        last_error: `OpenStreetMap provider returned HTTP ${response.status}.`,
        recommended_action:
          response.status === 406
            ? "Provider is blocked or not acceptable (HTTP 406). Keep the worker paused; review the safe diagnostic and provider policy before any explicit operator retry. Do not rotate endpoints or retry automatically."
            : response.status === 429
              ? "Wait for the provider's stated retry window; do not rotate endpoints to evade a limit."
              : "Review the safe request diagnostic and provider policy/configuration. Keep scheduling paused until the source explicitly accepts this workload.",
        http_status: response.status,
        response_valid: false,
      });
    }
    if (!bounded.body.trim()) {
      record(url, response.status, "provider_empty_response", {
        ...details,
        includeBodyExcerpt: true,
      });
      return completed(provider, wallStarted, perfStarted, "invalid_response", {
        ...common,
        last_success_at: null,
        last_error: "OpenStreetMap provider returned an empty health response.",
        recommended_action:
          "Check the configured endpoint and response format before scheduling work.",
        http_status: response.status,
        response_valid: false,
      });
    }
    let payload: { elements?: unknown };
    try {
      payload = JSON.parse(bounded.body) as { elements?: unknown };
    } catch {
      record(url, response.status, "provider_invalid_response", {
        ...details,
        includeBodyExcerpt: true,
      });
      return completed(provider, wallStarted, perfStarted, "invalid_response", {
        ...common,
        last_success_at: null,
        last_error:
          "OpenStreetMap provider returned an invalid health response.",
        recommended_action:
          "Check the configured endpoint response format before scheduling work.",
        http_status: response.status,
        response_valid: false,
      });
    }
    if (!Array.isArray(payload.elements)) {
      record(url, response.status, "provider_invalid_response", {
        ...details,
        includeBodyExcerpt: true,
      });
      return completed(provider, wallStarted, perfStarted, "invalid_response", {
        ...common,
        last_success_at: null,
        last_error:
          "OpenStreetMap provider returned an invalid health response.",
        recommended_action:
          "Check the configured endpoint response format before scheduling work.",
        http_status: response.status,
        response_valid: false,
      });
    }
    record(url, response.status, "success", {
      ...details,
      includeBodyExcerpt: false,
    });
    return completed(provider, wallStarted, perfStarted, "reachable", {
      ...common,
      last_success_at: new Date().toISOString(),
      last_error: null,
      recommended_action:
        "The bounded probe succeeded. Keep normal job caps, attribution, and retries in place. The worker is not enabled by this check.",
      http_status: response.status,
      response_valid: true,
    });
  } catch (cause) {
    const status = statusForFailure(cause);
    const timeout = status === "timeout";
    record(url, null, timeout ? "provider_timeout" : "network_error");
    if (cause instanceof OverpassProviderError) {
      return completed(provider, wallStarted, perfStarted, "unavailable", {
        ...common,
        last_success_at: null,
        last_error: "Invalid permitted Overpass endpoint configuration.",
        recommended_action:
          "Set a credential-free HTTPS interpreter URL whose policy permits this bounded workload.",
        http_status: null,
        response_valid: false,
      });
    }
    return completed(provider, wallStarted, perfStarted, status, {
      ...common,
      last_success_at: null,
      last_error: timeout
        ? "OpenStreetMap provider health check timed out."
        : "OpenStreetMap provider could not be reached.",
      recommended_action:
        "Check the permitted endpoint, network access, and provider status. Do not report an empty search as success.",
      http_status: null,
      response_valid: null,
    });
  }
}
