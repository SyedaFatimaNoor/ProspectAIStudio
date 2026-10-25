import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";
import { supabaseConfigured } from "@/lib/supabase-config";
import { emptyWorkspace } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET() {
  const config = {
    database: supabaseConfigured,
    discovery: Boolean(process.env.OVERPASS_URL),
    ai: Boolean(process.env.AI_BASE_URL && process.env.AI_MODEL),
  };
  try {
    const db = await serverSupabase();
    if (!db) return NextResponse.json({ ...emptyWorkspace, config });
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError && authError.name !== "AuthSessionMissingError")
      throw new Error(
        "Authentication connection failed. Check Supabase configuration and try again.",
      );
    if (!user) return NextResponse.json({ ...emptyWorkspace, config });
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
    const { data: profile, error: profileError } = await db
      .from("pa_profiles")
      .select("display_name")
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
        },
        config,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ...emptyWorkspace,
        config,
        error: e instanceof Error ? e.message : "Database connection failed.",
      },
      { status: 503 },
    );
  }
}
