export type AuthAttemptResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type AuthAttemptOptions = { limit: number; windowMs: number };

const storageKey = "prospectai:auth-attempts:v1";

/**
 * A deliberate browser-side brake for accidental/repeated auth submissions.
 * It stores timestamps only—never email addresses, passwords, tokens, or error
 * contents. It is not a substitute for Supabase/edge rate limiting because a
 * malicious caller can clear browser storage or call Supabase directly.
 */
export function takeStoredAuthAttempt(
  storage: StorageLike,
  action: string,
  options: AuthAttemptOptions,
  now = Date.now(),
): AuthAttemptResult {
  try {
    const parsed: Record<string, number[]> = JSON.parse(
      storage.getItem(storageKey) || "{}",
    );
    const attempts = (parsed[action] || []).filter(
      (timestamp) =>
        Number.isFinite(timestamp) && timestamp > now - options.windowMs,
    );
    if (attempts.length >= options.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((attempts[0] + options.windowMs - now) / 1000),
      );
      storage.setItem(storageKey, JSON.stringify({ ...parsed, [action]: attempts }));
      return { allowed: false, retryAfterSeconds };
    }
    storage.setItem(
      storageKey,
      JSON.stringify({ ...parsed, [action]: [...attempts, now] }),
    );
    return { allowed: true };
  } catch {
    // Storage can be unavailable in privacy modes. Do not block a legitimate
    // account action simply because this optional UX guard cannot persist.
    return { allowed: true };
  }
}

export function takeBrowserAuthAttempt(
  action: "credentials" | "password-reset" | "password-update",
  options: AuthAttemptOptions,
): AuthAttemptResult {
  if (typeof window === "undefined") return { allowed: true };
  return takeStoredAuthAttempt(window.localStorage, action, options);
}
