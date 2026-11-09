import { createClient } from "@supabase/supabase-js";
import type { RateLimitResult } from "./rate-limit";

/**
 * Optional shared, DB-backed limiter for multi-instance deployments. It is used
 * only when both server-only Supabase values are present and a service-role RPC
 * is available. The local in-memory limiter remains a documented fallback.
 *
 * The bucket key is an opaque server-side string; no client IP, credential,
 * cookie, or private user value is stored.
 */
export async function takeSharedRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  try {
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.rpc("pa_take_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error || !data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (typeof value.allowed !== "boolean") return null;
    return {
      allowed: value.allowed,
      limit: typeof value.limit === "number" ? value.limit : limit,
      remaining:
        typeof value.remaining === "number"
          ? value.remaining
          : Math.max(0, limit - 1),
      retryAfterSeconds:
        typeof value.retryAfterSeconds === "number"
          ? value.retryAfterSeconds
          : Math.max(1, Math.ceil(windowMs / 1000)),
    };
  } catch {
    // Fail open to the local per-instance limiter rather than breaking a
    // workspace read when the optional shared limiter is unreachable.
    return null;
  }
}
