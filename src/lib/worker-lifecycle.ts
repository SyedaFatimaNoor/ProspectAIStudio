// Portable worker lifecycle helpers. They contain no credentials, business data,
// or environment access so the same classification is used by hosted and local
// workers.
export const cloudWorkerVersion = "7.0.0";

export type WorkerFailureCategory =
  | "provider_blocked"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "transient_provider"
  | "invalid_job"
  | "invalid_response"
  | "cancelled"
  | "internal";

export type WorkerFailure = {
  category: WorkerFailureCategory;
  httpStatus: number | null;
  retryable: boolean;
};

function httpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Only transport failures and documented temporary provider statuses can retry.
 * A 406 is specifically a policy/access rejection and therefore blocks source
 * work pending an operator review; it is never retried automatically.
 */
export function classifyWorkerFailure(error: unknown): WorkerFailure {
  const detail =
    error && typeof error === "object"
      ? (error as { status?: unknown; category?: unknown; message?: unknown })
      : {};
  const message =
    typeof detail.message === "string"
      ? detail.message
      : error instanceof Error
        ? error.message
        : String(error || "");
  const matchedStatus = Number(
    /^.*\bHTTP\s+(\d{3})\b/i.exec(message)?.[1] || 0,
  );
  const status =
    httpStatus(detail.status) ??
    (matchedStatus >= 100 && matchedStatus <= 599 ? matchedStatus : null);

  if ([400, 401, 403, 404, 405, 406, 410, 422].includes(status || 0))
    return {
      category: "provider_blocked",
      httpStatus: status,
      retryable: false,
    };
  if (
    status === 429 ||
    detail.category === "rate_limited" ||
    detail.category === "provider_rate_limited"
  )
    return { category: "rate_limited", httpStatus: status, retryable: true };
  if ([408, 425, 500, 502, 503, 504].includes(status || 0))
    return {
      category: "transient_provider",
      httpStatus: status,
      retryable: true,
    };
  if (
    detail.category === "provider_rejected" ||
    detail.category === "provider_bad_request" ||
    detail.category === "provider_not_acceptable" ||
    detail.category === "provider_policy_blocked"
  )
    return {
      category: "provider_blocked",
      httpStatus: status,
      retryable: false,
    };
  if (detail.category === "provider_server_error")
    return {
      category: "transient_provider",
      httpStatus: status,
      retryable: true,
    };

  if (
    detail.category === "timeout" ||
    detail.category === "provider_timeout" ||
    /deadline exceeded|timed out/i.test(message)
  )
    return { category: "timeout", httpStatus: status, retryable: true };
  if (
    detail.category === "network_error" ||
    /fetch failed|connection|econnreset|etimedout|socket hang up|und_err/i.test(
      message,
    )
  )
    return { category: "network_error", httpStatus: status, retryable: true };
  if (
    detail.category === "invalid_json" ||
    detail.category === "invalid_response" ||
    detail.category === "incomplete_response" ||
    detail.category === "response_too_large" ||
    detail.category === "provider_invalid_response" ||
    detail.category === "provider_empty_response"
  )
    return {
      category: "invalid_response",
      httpStatus: status,
      retryable: false,
    };
  if (detail.category === "cancelled" || /search cancelled/i.test(message))
    return { category: "cancelled", httpStatus: status, retryable: false };
  if (
    /invalid bounded discovery job|unsupported discovery provider/i.test(
      message,
    )
  )
    return { category: "invalid_job", httpStatus: status, retryable: false };
  return { category: "internal", httpStatus: status, retryable: false };
}

/**
 * Provider/database exceptions may contain response fragments or connection
 * details. Persist an actionable, bounded explanation instead of raw untrusted
 * content; category and HTTP status carry the operational detail needed to act.
 */
export function safeWorkerFailureDetail(
  error: unknown,
  knownFailure?: WorkerFailure,
) {
  const failure = knownFailure || classifyWorkerFailure(error);
  const status = failure.httpStatus ? ` HTTP ${failure.httpStatus}` : "";
  switch (failure.category) {
    case "provider_blocked":
      return `OpenStreetMap provider rejected this request${status}. Automatic retry is disabled pending source review.`;
    case "rate_limited":
      return `OpenStreetMap provider rate limited this request${status}. A bounded retry window applies.`;
    case "timeout":
      return "OpenStreetMap provider request timed out. A bounded retry may be attempted.";
    case "network_error":
      return "OpenStreetMap provider could not be reached. A bounded retry may be attempted.";
    case "transient_provider":
      return `OpenStreetMap provider returned a temporary failure${status}. A bounded retry may be attempted.`;
    case "invalid_job":
      return "The discovery job failed validation and was not sent for an unbounded search.";
    case "invalid_response":
      return "OpenStreetMap provider returned an invalid or incomplete response. No result was created.";
    case "cancelled":
      return "Discovery was cancelled before a result could be committed.";
    default:
      return "Discovery worker failed internally. Review protected worker logs before retrying.";
  }
}

/** Stores an intentionally low-detail source marker, never an endpoint path or query. */
export function workerSource(snapshot: boolean, endpoint?: string | null) {
  if (snapshot) return "openstreetmap:snapshot";
  try {
    const hostname = new URL(endpoint || "").hostname.toLowerCase();
    return hostname ? `openstreetmap:${hostname}` : "openstreetmap:unknown";
  } catch {
    return "openstreetmap:unknown";
  }
}

export function boundedResponseTime(started: number) {
  return Math.min(80_000, Math.max(0, Math.round(performance.now() - started)));
}
