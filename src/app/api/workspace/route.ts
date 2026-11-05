import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";
import { supabaseConfigured } from "@/lib/supabase-config";
import { aiConfigured } from "@/lib/ai";
import { discoverySourceConfigured, localSourceOnly } from "@/lib/discovery";
import { emptyWorkspace, type Workspace } from "@/lib/types";
import {
  clientRateLimitKey,
  rateLimitHeaders,
  takeRateLimit,
} from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const rate = takeRateLimit(clientRateLimitKey(req.headers, "workspace-read"), {
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed)
    return NextResponse.json(
      { error: "Too many workspace refreshes. Please wait a moment and try again." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  const config: Workspace["config"] = {
    database: supabaseConfigured,
    discovery: discoverySourceConfigured(),
    ai: aiConfigured(),
    self_hosted_worker: localSourceOnly(),
  };
  try {
    const db = await serverSupabase();
    if (!db)
      return NextResponse.json(
        { ...emptyWorkspace, config },
        { headers: rateLimitHeaders(rate) },
      );
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError && authError.name !== "AuthSessionMissingError")
      throw new Error(
        "Authentication connection failed. Check Supabase configuration and try again.",
      );
    if (!user)
      return NextResponse.json(
        { ...emptyWorkspace, config },
        { headers: rateLimitHeaders(rate) },
      );
    // Backwards-compatible when this optional migration has not been installed.
    // This function exposes only operational metadata, never tokens or job owners.
    const { data: worker, error: workerError } = await db.rpc(
      "pa_cloud_worker_status",
    );
    if (!workerError && worker) config.worker = worker;
    // Optional snapshot status is aggregate-only and available to authenticated
    // operators. A missing migration is intentionally non-fatal for existing
    // deployments; it must never make an empty snapshot look ready.
    const { data: snapshot, error: snapshotError } = await db.rpc(
      "pa_osm_snapshot_status",
    );
    if (!snapshotError && snapshot) config.snapshot = snapshot;
    const tables = {
      businesses: "businesses",
      jobs: "discovery_jobs",
      proposals: "proposals",
      messages: "outreach_messages",
      runs: "verification_runs",
      suppressions: "suppression_records",
      events: "outreach_events",
      settings: "integration_settings",
    };
    const results = await Promise.all(
      Object.entries(tables).map(async ([key, table]) => {
        const { data, error, count } = await db
          .from(`pa_${table}`)
          .select("*", { count: "exact" })
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (error) throw new Error(`Unable to load ${key}: ${error.message}`);
        return [
          key,
          key === "settings" ? data?.[0] || null : data || [],
          (count || 0) > (data?.length || 0),
        ];
      }),
    );
    // Optional until the provider-health migration is applied. Its absence must
    // not make the normal workspace unreadable on an existing deployment.
    const { data: providerHealth, error: providerHealthError } = await db
      .from("pa_provider_health")
      .select("provider,status,checked_at,last_success_at,latency_ms,last_error,recommended_action")
      .eq("user_id", user.id)
      .order("checked_at", { ascending: false });
    const { data: profile, error: profileError } = await db
      .from("pa_profiles")
      .select("display_name,updated_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError)
      throw new Error("Unable to load profile: " + profileError.message);
    return NextResponse.json(
      {
        ...Object.fromEntries(results),
        windowed: results.some((r) => Boolean(r[2])),
        user: {
          id: user.id,
          email: user.email,
          display_name: profile?.display_name || "",
          updated_at: profile?.updated_at || undefined,
        },
        // An unavailable optional health table intentionally appears as an empty
        // history rather than a database outage.
        provider_health: providerHealthError ? [] : providerHealth || [],
        config,
      },
      { headers: rateLimitHeaders(rate) },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ...emptyWorkspace,
        config,
        error: e instanceof Error ? e.message : "Database connection failed.",
      },
      { status: 503, headers: rateLimitHeaders(rate) },
    );
  }
}
