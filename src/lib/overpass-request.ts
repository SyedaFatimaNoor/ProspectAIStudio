// Canonical Overpass transport for the FOSSGIS-operated public interpreter.
//
// Official references:
// - FOSSGIS usage terms require a valid application-identifying User-Agent and,
//   where technically possible, an HTTP Referrer; scripts are limited to one
//   connection and commercial/high-traffic use is restricted.
//   https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/
// - Overpass accepts GET and POST. The `data=` prefix means the query is URL
//   encoded; no other request headers affect Overpass behaviour.
//   https://dev.overpass-api.de/command_line.html
// - The OpenStreetMap Wiki developer example posts `data=` + encoded query to
//   `https://overpass-api.de/api/interpreter` and parses the result as JSON.
//   https://wiki.openstreetmap.org/wiki/Overpass_API
//
// Native Web APIs only; suitable for Node and Supabase Edge. No browser cookies,
// private credentials, or unnecessary headers are sent. Standard fetch handles
// content decompression, so this module never sets Accept-Encoding or attempts
// a second decompression of the response stream.

export const overpassEndpoint =
  "https://overpass-api.de/api/interpreter";
export const overpassUserAgent =
  "ProspectAI/1.0 (+https://prospectaistudio.vercel.app/responsible-use)";
export const overpassReferer =
  "https://prospectaistudio.vercel.app/responsible-use";
export const overpassDiscoveryTimeoutMs = 30_000;
export const overpassHealthTimeoutMs = 12_000;
export const overpassQueryTimeoutSeconds = 25;
export const overpassResponseLimitBytes = 3_000_000;
export const overpassDiagnosticExcerptLimit = 500;

export type OverpassMethod = "GET" | "POST";

export type OverpassErrorCategory =
  | "success"
  | "empty_result"
  | "provider_bad_request"
  | "provider_not_acceptable"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_server_error"
  | "provider_invalid_response"
  | "provider_empty_response"
  | "provider_policy_blocked"
  | "cancelled"
  | "network_error";

export type OverpassRequestLog = {
  provider: "openstreetmap";
  provider_hostname: string;
  http_method: OverpassMethod;
  request_id: string;
  status_code: number | null;
  response_time_ms: number;
  response_content_type: string | null;
  response_body_length: number;
  response_excerpt: string;
  error_category: OverpassErrorCategory;
};

export class OverpassProviderError extends Error {
  constructor(
    message: string,
    readonly category: Exclude<
      OverpassErrorCategory,
      "success" | "empty_result"
    >,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OverpassProviderError";
  }
}

function validReferer() {
  try {
    const value = new URL(overpassReferer);
    if (
      value.protocol !== "https:" ||
      value.username ||
      value.password ||
      value.search ||
      value.hash
    )
      return null;
    return value.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Deliberately minimal headers. FOSSGIS requires an identifying User-Agent and
 * a valid Referrer where possible. Overpass documentation says no other request
 * headers affect GET/POST behaviour, so no explicit Accept is sent; the runtime
 * wildcard default avoids incorrectly forcing a representation that a front
 * door could reject with 406. Content-Type is sent only for a form-encoded POST.
 */
export function overpassRequestHeaders(method: OverpassMethod) {
  const headers: Record<string, string> = {
    "User-Agent": overpassUserAgent,
  };
  const referer = validReferer();
  if (referer) headers.Referer = referer;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return headers;
}

/**
 * Validates the configured interpreter URL and, for small GET probes, places
 * the bounded query in a correctly encoded `data` parameter. Larger discovery
 * queries use POST with the query in the body instead.
 */
export function overpassEndpointUrl(
  endpoint: string,
  query: string,
  method: OverpassMethod,
) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new OverpassProviderError(
      "Invalid Overpass endpoint. A credential-free HTTPS interpreter URL is required.",
      "provider_bad_request",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new OverpassProviderError(
      "Invalid Overpass endpoint. HTTPS with no embedded credentials, query, or fragment is required.",
      "provider_bad_request",
    );
  if (method === "GET") url.searchParams.set("data", query);
  return url;
}

export function overpassRequestInit(
  method: OverpassMethod,
  query: string,
  signal: AbortSignal,
): RequestInit {
  const init: RequestInit = {
    method,
    headers: overpassRequestHeaders(method),
    signal,
  };
  if (method === "POST") {
    init.body = new URLSearchParams({ data: query });
  }
  return init;
}

/**
 * Bounded, redacted excerpt only. Successful JSON is represented by a marker,
 * never copied into logs; error bodies are stripped of markup and obvious
 * secrets/contact data before truncation.
 */
export function sanitiseProviderExcerpt(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|api[_ -]?key|password|secret|token|access[_ -]?token)\b\s*[:=]?\s*[^\s,;]+/gi,
      "[redacted]",
    )
    .replace(
      /\b[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[email-redacted]",
    )
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone-redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url-redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, overpassDiagnosticExcerptLimit);
}

export type BoundedProviderResponse = {
  body: string;
  length: number;
  contentType: string | null;
  excerpt: string;
  tooLarge: boolean;
};

/**
 * Reads the already-decompressed fetch stream with a byte cap. `fetch` handles
 * standard Content-Encoding decompression; adding Accept-Encoding or manually
 * decompressing here would be incorrect. The logged length is decoded bytes,
 * not a possibly-compressed Content-Length header.
 */
export async function readBoundedProviderResponse(
  response: Response,
  limit = overpassResponseLimitBytes,
): Promise<BoundedProviderResponse> {
  const contentType = response.headers.get("content-type");
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      body: "",
      length: 0,
      contentType,
      excerpt: "",
      tooLarge: false,
    };
  }
  let body = "";
  let length = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        return {
          body,
          length,
          contentType,
          excerpt: sanitiseProviderExcerpt(body),
          tooLarge: true,
        };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return {
      body,
      length,
      contentType,
      excerpt: sanitiseProviderExcerpt(body),
      tooLarge: false,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function overpassRequestLog(options: {
  url: URL;
  method: OverpassMethod;
  requestId: string;
  started: number;
  status: number | null;
  contentType?: string | null;
  bodyLength?: number;
  excerpt?: string;
  category: OverpassErrorCategory;
  includeBodyExcerpt?: boolean;
}): OverpassRequestLog {
  const successLike =
    options.category === "success" || options.category === "empty_result";
  const excerpt = options.includeBodyExcerpt
    ? sanitiseProviderExcerpt(options.excerpt || "")
    : successLike
      ? "[successful provider response omitted]"
      : "";
  return {
    provider: "openstreetmap",
    provider_hostname: options.url.hostname,
    http_method: options.method,
    request_id: options.requestId,
    status_code: options.status,
    response_time_ms: Math.max(
      0,
      Math.round(performance.now() - options.started),
    ),
    response_content_type: options.contentType ?? null,
    response_body_length: options.bodyLength ?? 0,
    response_excerpt: excerpt,
    error_category: options.category,
  };
}

export function logOverpassDiagnostic(entry: OverpassRequestLog) {
  // Contains only safe operational metadata; no URL path/query, request body,
  // credentials, cookies, or complete provider response.
  console.info(JSON.stringify(entry));
}

/**
 * Status handling is driven by the HTTP status and the sanitised response
 * excerpt, not by an assumption that 406 is always an endpoint/network ban.
 */
export function categoryForStatus(status: number, excerpt: string) {
  if (status === 400) return "provider_bad_request" as const;
  if (status === 401 || status === 403)
    return "provider_policy_blocked" as const;
  if ([404, 405, 410, 422].includes(status))
    return "provider_bad_request" as const;
  if (status === 406)
    return /block|ban|policy|user[- ]?agent|refer|hosting|platform|denied|forbidden/i.test(
      excerpt,
    )
      ? ("provider_policy_blocked" as const)
      : ("provider_not_acceptable" as const);
  if (status === 408) return "provider_timeout" as const;
  if (status === 429) return "provider_rate_limited" as const;
  if (status >= 500) return "provider_server_error" as const;
  if (status >= 400) return "provider_bad_request" as const;
  return "provider_invalid_response" as const;
}

export function overpassFailureMessage(
  status: number,
  category?: OverpassErrorCategory,
) {
  const prefix = `OpenStreetMap provider returned HTTP ${status}.`;
  if (status === 406)
    return `${prefix} Review the safe request diagnostic to identify whether this is content negotiation or a provider policy block. Do not retry automatically or rotate endpoints.`;
  if (status === 429)
    return `${prefix} The provider rate limited this request; only a bounded retry window may apply.`;
  if (status === 400)
    return `${prefix} Review query encoding and request parameters before an operator-led retry.`;
  if (status === 401 || status === 403)
    return `${prefix} The provider indicated a policy/access block; operator review is required.`;
  if (status === 408)
    return `${prefix} The provider reported a timeout. A bounded retry may apply.`;
  if (status >= 500)
    return `${prefix} The provider reported a temporary server failure. A bounded retry may apply.`;
  if (status >= 400)
    return `${prefix} The request was rejected. Review provider policy/configuration before any operator-led retry.`;
  if (category === "provider_empty_response")
    return "OpenStreetMap provider returned an empty response. No search result was created.";
  if (category === "provider_invalid_response")
    return "OpenStreetMap provider returned an invalid response. No search result was created.";
  return `${prefix} The provider did not complete the request; retries are bounded and never treated as an empty successful search.`;
}
