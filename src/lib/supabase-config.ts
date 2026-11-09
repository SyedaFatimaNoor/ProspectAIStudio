/**
 * Public connection defaults for this application's existing Supabase project.
 * Publishable keys are intentionally browser-safe; RLS and authenticated sessions
 * protect data. Never place a service-role/secret key in this module.
 *
 * Keep these public defaults in source so a resumed preview does not lose its
 * connection when ignored .env.local files are not restored. Deployments may
 * override both values together through NEXT_PUBLIC_* environment variables.
 */
const projectUrl = "https://vfplvwtububtaovyalgu.supabase.co";
const projectPublishableKey =
  "sb_publishable_4_7mo5M2l9vxJCRuf8hzeA_fYPijLZA";
const allowPublicDefaults =
  process.env.NEXT_PUBLIC_ALLOW_PUBLIC_DEFAULTS === "1";

const overrideUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const overrideKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const hasOverride = Boolean(overrideUrl && overrideKey);
const partialOverride = Boolean(overrideUrl || overrideKey);

// Fail closed on a partial override and require an explicit opt-in for the
// source defaults. Deployments must provide both public values together or
// deliberately enable the documented preview fallback.
export const supabaseUrl = hasOverride
  ? overrideUrl || ""
  : partialOverride || !allowPublicDefaults
    ? ""
    : projectUrl;
export const supabasePublishableKey = hasOverride
  ? overrideKey || ""
  : partialOverride || !allowPublicDefaults
    ? ""
    : projectPublishableKey;
export const supabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);
