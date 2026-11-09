import type { Job, ProviderHealthRecord, Workspace } from "./types";

export type DiscoveryAvailabilityCode =
  | "loading"
  | "workspace_unavailable"
  | "signed_out"
  | "missing_configuration"
  | "empty_snapshot"
  | "provider_406"
  | "provider_blocked"
  | "provider_timeout"
  | "worker_paused"
  | "worker_unavailable"
  | "worker_stalled"
  | "available";

export type DiscoveryAvailability = {
  available: boolean;
  code: DiscoveryAvailabilityCode;
  reason: string;
  recommendedAction: string;
  fixability: "user" | "operator" | "none";
  lastWorkerActivity: string | null;
  lastProviderCheck: ProviderHealthRecord | null;
  lastHttpStatus: number | null;
  responseTimeMs: number | null;
};

export type DiscoveryJobOutcome = {
  title:
    | "Invalid search input"
    | "Provider HTTP 406"
    | "Provider blocked"
    | "Provider timeout"
    | "Provider rate limit"
    | "No results found"
    | "Successful completion";
  tone: "error" | "info" | "success";
  detail: string;
};

const permanentProviderStatuses = new Set([
  400, 401, 403, 404, 405, 406, 410, 422,
]);

export function httpStatusFromText(...values: (string | null | undefined)[]) {
  for (const value of values) {
    const match = /\bHTTP\s+(\d{3})\b/i.exec(value || "");
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Operational messages are intentionally bounded/redacted before rendering.
 * Status, duration and the curated recommended action are useful; credentials,
 * token-shaped strings and connection internals are not.
 */
export function safeOperationalMessage(
  value: string | null | undefined,
  fallback = "No detail was recorded.",
) {
  if (!value || !value.trim()) return fallback;
  return value
    .replace(
      /\b(?:authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
      "[redacted]",
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:api[_ -]?key|password|secret|token|access[_ -]?token)\b\s*[:=]?\s*[^\s,;]+/gi,
      "[redacted]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(/\b(?:sk|pk|rk|ghp)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function providerHealth(
  data: Workspace,
  provider: ProviderHealthRecord["provider"],
) {
  return (
    data.provider_health.find((health) => health.provider === provider) || null
  );
}

function snapshotIsEmpty(data: Workspace) {
  const snapshot = data.config.snapshot;
  return Boolean(
    snapshot &&
    (snapshot.import_status === "empty" ||
      !snapshot.businesses ||
      !snapshot.places),
  );
}

function lastWorkerActivity(data: Workspace) {
  const worker = data.config.worker;
  return (
    worker?.last_finished_at ||
    worker?.last_heartbeat_at ||
    worker?.last_started_at ||
    null
  );
}

function workerStall(data: Workspace, now = Date.now()) {
  const worker = data.config.worker;
  if (!worker || data.config.self_hosted_worker || worker.enabled === false)
    return null;
  const intervalMs = Math.max(1, worker.interval_minutes || 5) * 60_000;
  const staleAfter = intervalMs * 3;
  const heartbeat = worker.last_heartbeat_at
    ? new Date(worker.last_heartbeat_at).getTime()
    : null;
  const oldestQueued = data.jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => new Date(job.created_at).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const heartbeatStale =
    heartbeat !== null &&
    Number.isFinite(heartbeat) &&
    now - heartbeat > staleAfter;
  const queueStale =
    oldestQueued !== undefined && now - oldestQueued > staleAfter;
  if (!heartbeatStale && !queueStale) return null;
  return {
    heartbeatStale,
    queueStale,
    staleAfter,
    oldestQueued: oldestQueued ?? null,
  };
}

function responseTime(data: Workspace, health: ProviderHealthRecord | null) {
  if (typeof health?.latency_ms === "number") return health.latency_ms;
  const failed = data.config.worker?.last_failed_job?.response_time_ms;
  if (typeof failed === "number") return failed;
  const successful = data.config.worker?.last_successful_job?.response_time_ms;
  return typeof successful === "number" ? successful : null;
}

function unavailable(
  code: Exclude<DiscoveryAvailabilityCode, "available">,
  reason: string,
  recommendedAction: string,
  fixability: "user" | "operator",
  details: Pick<
    DiscoveryAvailability,
    | "lastWorkerActivity"
    | "lastProviderCheck"
    | "lastHttpStatus"
    | "responseTimeMs"
  >,
): DiscoveryAvailability {
  return {
    available: false,
    code,
    reason,
    recommendedAction,
    fixability,
    ...details,
  };
}

/**
 * Decides only whether the interface may queue a bounded discovery job. It does
 * not make a provider request, expose an endpoint path, or infer provider
 * readiness from a configured environment variable.
 */
export function discoveryAvailability(
  data: Workspace,
  loading = false,
  connectionError: string | null = null,
): DiscoveryAvailability {
  const check = providerHealth(data, "discovery");
  const workerCheck = providerHealth(data, "worker");
  const worker = data.config.worker;
  const status = httpStatusFromText(
    check?.last_error,
    worker?.last_provider_error,
    worker?.last_error,
  );
  const details = {
    lastWorkerActivity: lastWorkerActivity(data),
    lastProviderCheck: check,
    lastHttpStatus: status,
    responseTimeMs: responseTime(data, check),
  };

  if (loading)
    return unavailable(
      "loading",
      "Workspace status is still loading, so discovery cannot be queued yet.",
      "Wait for the workspace status to finish loading, then try again.",
      "user",
      details,
    );
  if (connectionError || data.error)
    return unavailable(
      "workspace_unavailable",
      "Workspace connection failed, so the application cannot safely queue discovery.",
      "Refresh the workspace. If the connection error persists, ask the operator to check the database connection.",
      "user",
      details,
    );
  if (!data.user)
    return unavailable(
      "signed_out",
      "Sign in to queue a search. Read-only preview cannot save a discovery job or run a search.",
      "Sign in to your workspace, then enter a bounded search.",
      "user",
      details,
    );
  if (!data.config.database)
    return unavailable(
      "missing_configuration",
      "Database setup is required, so a discovery job cannot be saved safely.",
      "Ask the operator to configure Supabase and apply the workspace migrations.",
      "operator",
      details,
    );
  if (snapshotIsEmpty(data))
    return unavailable(
      "empty_snapshot",
      "The OpenStreetMap snapshot is enabled but has no searchable places or businesses.",
      "Ask the operator to load a lawful, attributed extract and validate one bounded search while scheduling remains paused.",
      "operator",
      details,
    );
  if (!data.config.discovery)
    return unavailable(
      "missing_configuration",
      safeOperationalMessage(
        data.config.discovery_error,
        "No discovery source is configured. Use only a permitted source.",
      ),
      "Ask the operator to configure a permitted source or a ready attributed OSM snapshot.",
      "operator",
      details,
    );

  const blockedCategories = new Set([
    "provider_blocked",
    "provider_bad_request",
    "provider_not_acceptable",
    "provider_policy_blocked",
  ]);
  const providerBlocked =
    worker?.lifecycle_state === "blocked" ||
    (worker?.last_error_category !== null &&
      worker?.last_error_category !== undefined &&
      blockedCategories.has(worker.last_error_category)) ||
    check?.status === "blocked" ||
    (status !== null && permanentProviderStatuses.has(status));
  if (providerBlocked)
    return unavailable(
      status === 406 ? "provider_406" : "provider_blocked",
      status === 406
        ? "OpenStreetMap returned HTTP 406 and rejected this workload. Automatic retries are disabled."
        : `The configured provider rejected discovery${status ? ` with HTTP ${status}` : ""}.`,
      "Ask the operator to review provider policy and source configuration. Do not rotate endpoints or retry to bypass the provider decision.",
      "operator",
      details,
    );

  // A locally configured source runs its own worker. Its hosted scheduler may
  // be paused without preventing that separate worker from processing a job.
  const selfHostedWorker = Boolean(data.config.self_hosted_worker);
  if (
    !selfHostedWorker &&
    (worker?.enabled === false || worker?.lifecycle_state === "paused")
  )
    return unavailable(
      "worker_paused",
      "Worker paused — discovery unavailable. Discovery is temporarily unavailable because the source worker is paused. Queued work would not be processed.",
      "Ask the operator to resolve the source/setup issue before resuming the worker.",
      "operator",
      details,
    );

  const stall = workerStall(data);
  if (stall)
    return unavailable(
      "worker_stalled",
      "Discovery scheduler appears stalled. A queued job has waited longer than three scheduler intervals, or the worker heartbeat is stale. No new job should be queued as if the worker were healthy.",
      "Ask the operator to verify the Vault token, cron schedule, Edge Function deployment, worker heartbeat, and protected scheduler logs. Keep the worker paused until one bounded real job succeeds.",
      "operator",
      details,
    );

  const timeout =
    worker?.last_error_category === "timeout" ||
    /\btimeout|timed out\b/i.test(check?.last_error || "");
  if (timeout && check?.status === "unreachable")
    return unavailable(
      "provider_timeout",
      "The most recent provider check timed out, so discovery is temporarily unavailable.",
      "Ask the operator to check the permitted endpoint and network path. Do not treat a timeout as an empty search result.",
      "operator",
      details,
    );

  if (
    !selfHostedWorker &&
    (worker?.lifecycle_state === "failed" ||
      workerCheck?.status === "unreachable")
  )
    return unavailable(
      "worker_unavailable",
      "The worker is unavailable, so discovery cannot be processed reliably.",
      "Ask the operator to review worker health, scheduler access, and the protected worker logs.",
      "operator",
      details,
    );

  return {
    available: true,
    code: "available",
    reason:
      "Discovery is configured. A queued job is not a completed provider search.",
    recommendedAction:
      check?.status === "rate_limited" ||
      worker?.lifecycle_state === "rate_limited"
        ? "The provider is rate limited. You may queue bounded work, but the worker waits for its retry window."
        : "Enter a bounded search and review the resulting job log before treating any listing as evidence.",
    fixability: "none",
    ...details,
  };
}

export function discoveryFixabilityLabel(
  fixability: DiscoveryAvailability["fixability"],
) {
  if (fixability === "user") return "User-fixable";
  if (fixability === "operator") return "Operator-fixable";
  return "No fix needed";
}

export function discoveryJobOutcome(job: Job): DiscoveryJobOutcome | null {
  const status = httpStatusFromText(job.error);
  const category = job.error_category || "";
  if (
    category === "invalid_job" ||
    /invalid (?:bounded )?(?:discovery )?job|validation/i.test(job.error || "")
  )
    return {
      title: "Invalid search input",
      tone: "error",
      detail:
        "This job did not pass bounded discovery validation. Correct the search fields and queue a new job; no source result was created.",
    };
  if (
    job.status === "blocked" ||
    [
      "provider_blocked",
      "provider_bad_request",
      "provider_not_acceptable",
      "provider_policy_blocked",
    ].includes(category) ||
    status === 406
  )
    return {
      title: status === 406 ? "Provider HTTP 406" : "Provider blocked",
      tone: "error",
      detail:
        status === 406
          ? "Blocked after a provider or policy error. Review the safe request diagnostic to identify whether this is content negotiation or a provider policy block. No automatic retry will run, including for HTTP 406; operator review is required before any explicit retry."
          : "The provider rejected this work. No automatic retry will run until the source setup is reviewed.",
    };
  if (category === "timeout" || /\btimeout|timed out\b/i.test(job.error || ""))
    return {
      title: "Provider timeout",
      tone: "error",
      detail:
        "No absence inference made. The provider did not respond in time, so this is not an empty result; only a bounded safe retry may run.",
    };
  if (
    job.status === "rate_limited" ||
    category === "rate_limited" ||
    status === 429
  )
    return {
      title: "Provider rate limit",
      tone: "info",
      detail:
        "The provider asked the worker to slow down. The job waits for its bounded retry window and is not treated as complete.",
    };
  if (job.status === "completed") {
    const resultCount = job.result_count ?? job.total;
    if (resultCount === 0)
      return {
        title: "No results found",
        tone: "info",
        detail:
          "The source completed this bounded search with no matching listings. No leads were fabricated.",
      };
    return {
      title: "Successful completion",
      tone: "success",
      detail: `${resultCount} source listing${resultCount === 1 ? " was" : "s were"} processed. Listings remain subject to evidence review.`,
    };
  }
  return null;
}
