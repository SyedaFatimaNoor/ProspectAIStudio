export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };
type RateLimitScope = typeof globalThis & {
  __prospectAiRateLimitBuckets?: Map<string, Bucket>;
};

// A dependency-free baseline that protects a single runtime immediately. It is
// deliberately short-lived and stores only a transient client identifier. A
// multi-region deployment should layer a configured shared limiter in front of
// it; this fallback must not be described as a global distributed control.
const scope = globalThis as RateLimitScope;
const buckets =
  scope.__prospectAiRateLimitBuckets ??
  (scope.__prospectAiRateLimitBuckets = new Map<string, Bucket>());

export function clientRateLimitKey(
  headers: Pick<Headers, "get">,
  route: string,
) {
  // Vercel supplies x-vercel-forwarded-for. The forwarded header keeps local
  // and other trusted reverse-proxy deployments functional. The value is never
  // written to the database or logs and expires with its bucket.
  const forwarded =
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  return `${route}:${forwarded.trim().slice(0, 200) || "unknown"}`;
}

export function takeRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > 10000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count >= limit)
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds,
    };
  bucket.count += 1;
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds,
  };
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.retryAfterSeconds),
    ...(result.allowed ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}
