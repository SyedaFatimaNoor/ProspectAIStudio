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
const projectPublishableKey = "sb_publishable_4_7mo5M2l9vxJCRuf8hzeA_fYPijLZA";

const overrideUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const overrideKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const hasOverride = Boolean(overrideUrl || overrideKey);

// Never combine a custom project's URL with this project's publishable key.
export const supabaseUrl = hasOverride ? overrideUrl || "" : projectUrl;
export const supabasePublishableKey = hasOverride
  ? overrideKey || ""
  : projectPublishableKey;
export const supabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);
