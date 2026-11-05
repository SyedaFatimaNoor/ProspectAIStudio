import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverSupabase } from "@/lib/supabase";
import {
  idSchema,
  jobSchema,
  proposalSchema,
  messageSchema,
  settingsSchema,
  manualSchema,
  displayNameSchema,
} from "@/lib/validation";
import { AIProviderError, CompatibleAI } from "@/lib/ai";
import {
  generateAndSaveConcept,
  type ConceptRepository,
  type StoredConceptProposal,
} from "@/lib/ai-workflow";
import {
  checkProviderHealth,
  healthProviderSchema,
  type ProviderHealth,
} from "@/lib/provider-health";
import {
  discoverySourceConfigured,
  localSourceOnly,
  snapshotEnabled,
} from "@/lib/discovery";
import { snapshotReadiness } from "@/lib/source-readiness";
import {
  cloudPauseBlocksDiscovery,
  pausedCloudWorkerMessage,
} from "@/lib/cloud-worker";
import {
  clientRateLimitKey,
  rateLimitHeaders,
  takeRateLimit,
} from "@/lib/rate-limit";
import { rejectClientTenantOverride } from "@/lib/tenant-security";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (
      origin &&
      new URL(origin).host !== req.headers.get("host") &&
      new URL(origin).host !== req.headers.get("x-forwarded-host")
    )
      return NextResponse.json(
        { error: "Invalid request origin." },
        { status: 403 },
      );
    const rate = takeRateLimit(
      clientRateLimitKey(req.headers, "workspace-action"),
      {
        limit: 30,
        windowMs: 60_000,
      },
    );
    if (!rate.allowed)
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: rateLimitHeaders(rate) },
      );
    if (Number(req.headers.get("content-length") || 0) > 100000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const db = await serverSupabase();
    if (!db)
      return NextResponse.json(
        { error: "Connect Supabase to save workspace data." },
        { status: 503 },
      );
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in to your workspace before making changes." },
        { status: 401 },
      );
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > 100000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = rejectClientTenantOverride(JSON.parse(raw));
    const type = z.object({ type: z.string().trim().min(1) }).parse(input).type;
    // Never use a client-supplied tenant/workspace identifier. Every query
    // below derives its scope from this verified Supabase session user.
    const user_id = user.id;
    if (type === "test_ai" || type === "test_provider") {
      const checkedProvider =
        type === "test_ai"
          ? "ai"
          : z.string().trim().max(40).parse(input.provider);
      const healthRate = takeRateLimit(
        `provider-health:${user_id}:${checkedProvider}`,
        { limit: 3, windowMs: 5 * 60_000 },
      );
      if (!healthRate.allowed)
        return NextResponse.json(
          {
            error: `Provider health checks for ${checkedProvider} are limited to 3 per 5 minutes. Please wait before retrying.`,
          },
          { status: 429, headers: rateLimitHeaders(healthRate) },
        );
    }
    async function insert(table: string, values: Record<string, unknown>) {
      const r = await db!
        .from(`pa_${table}`)
        .insert({ ...values, user_id })
        .select()
        .single();
      if (r.error) throw new Error(r.error.message);
      return r.data;
    }
    async function owned(table: string, id: string) {
      const r = await db!
        .from(`pa_${table}`)
        .select("*")
        .eq("id", id)
        .eq("user_id", user_id)
        .single();
      if (r.error || !r.data)
        throw new Error("Record not found or access denied.");
      return r.data;
    }
    async function update(
      table: string,
      id: string,
      values: Record<string, unknown>,
    ) {
      const r = await db!
        .from(`pa_${table}`)
        .update(values)
        .eq("id", id)
        .eq("user_id", user_id)
        .select()
        .single();
      if (r.error || !r.data)
        throw new Error(r.error?.message || "Record not found.");
      return r.data;
    }
    async function audit(
      entity_id: string | null,
      detail: Record<string, unknown> = {},
    ) {
      await insert("audit_logs", { action: type, entity_id, detail });
    }
    async function saveProviderHealth(health: ProviderHealth) {
      const { data: prior, error: priorError } = await db!
        .from("pa_provider_health")
        .select("last_success_at")
        .eq("user_id", user_id)
        .eq("provider", health.provider)
        .maybeSingle();
      if (priorError)
        throw new Error(
          `Unable to read provider health: ${priorError.message}`,
        );
      const { data: saved, error } = await db!
        .from("pa_provider_health")
        .upsert(
          {
            user_id,
            ...health,
            last_success_at:
              health.last_success_at || prior?.last_success_at || null,
          },
          { onConflict: "user_id,provider" },
        )
        .select()
        .single();
      if (error)
        throw new Error(`Unable to save provider health: ${error.message}`);
      return saved;
    }
    let result: unknown = { ok: true };
    switch (type) {
      case "create_job": {
        if (!discoverySourceConfigured())
          return NextResponse.json(
            {
              error:
                "No discovery source is configured. Configure a reviewed Overpass endpoint, a local extract, or an attributed OSM snapshot. No search was run.",
            },
            { status: 409 },
          );
        if (snapshotEnabled()) {
          const { data: snapshot, error: snapshotError } = await db.rpc(
            "pa_osm_snapshot_status",
          );
          const readiness = snapshotReadiness(snapshotError ? null : snapshot);
          if (!readiness.ready)
            return NextResponse.json(
              {
                error:
                  readiness.message ||
                  "The OpenStreetMap snapshot is not ready for discovery. No search was run.",
              },
              { status: 409 },
            );
        }
        // A missing status function is intentionally not treated as a failure:
        // self-hosted deployments may use a separate worker. An explicit pause,
        // however, must reject direct API calls as well as the disabled UI.
        const { data: worker, error: workerStatusError } = await db.rpc(
          "pa_cloud_worker_status",
        );
        if (
          !workerStatusError &&
          cloudPauseBlocksDiscovery(worker, localSourceOnly())
        )
          return NextResponse.json(
            { error: pausedCloudWorkerMessage },
            { status: 409 },
          );
        const v = jobSchema.parse(input);
        const { data: settings } = await db
          .from("pa_integration_settings")
          .select("search_limit")
          .eq("user_id", user_id)
          .maybeSingle();
        if (v.max_results > (settings?.search_limit || 100))
          throw new Error("This search exceeds your configured result limit.");
        const { count } = await db
          .from("pa_discovery_jobs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user_id)
          .in("status", ["queued", "running", "rate_limited"]);
        if ((count || 0) >= 3)
          throw new Error(
            "Finish or cancel an existing job before starting another. Maximum 3 active jobs.",
          );
        result = await insert("discovery_jobs", {
          ...v,
          logs: [
            `${new Date().toISOString()} Job queued. Waiting for a configured worker.`,
          ],
        });
        await audit((result as { id: string }).id);
        break;
      }
      case "update_job": {
        const id = idSchema.parse(input.id);
        const status = z
          .enum(["queued", "paused", "cancelled"])
          .parse(input.status);
        const j = await owned("discovery_jobs", id);
        if (["completed", "cancelled"].includes(j.status))
          throw new Error("A finished job cannot be changed.");
        if (
          status === "queued" &&
          !["paused", "failed", "blocked"].includes(j.status)
        )
          throw new Error(
            "Only paused, failed, or reviewed blocked jobs can be resumed. Rate-limited jobs wait for their scheduled retry.",
          );
        if (
          status === "queued" &&
          j.error_category === "rate_limited" &&
          j.next_retry_at &&
          new Date(j.next_retry_at).getTime() > Date.now()
        )
          throw new Error(
            "This job is rate limited and must wait for its scheduled retry window.",
          );
        if (status === "queued") {
          const { data: worker, error: workerStatusError } = await db.rpc(
            "pa_cloud_worker_status",
          );
          if (
            !workerStatusError &&
            cloudPauseBlocksDiscovery(worker, localSourceOnly())
          )
            throw new Error(pausedCloudWorkerMessage);
        }
        if (
          status === "paused" &&
          !["queued", "running", "rate_limited"].includes(j.status)
        )
          throw new Error(
            "Only queued, running, or rate-limited jobs can be paused.",
          );
        result = await update("discovery_jobs", id, {
          status,
          ...(status === "queued"
            ? {
                attempts: 0,
                next_retry_at: new Date().toISOString(),
                error: null,
                error_category: null,
                started_at: null,
                completed_at: null,
                response_time_ms: null,
                result_count: null,
                duplicate_count: null,
              }
            : {}),
          logs: [
            ...j.logs,
            `${new Date().toISOString()} User requested ${status}.`,
          ],
        });
        break;
      }
      case "save_notes": {
        const id = idSchema.parse(input.id);
        result = await update("businesses", id, {
          notes: z.string().max(10000).parse(input.notes),
        });
        await audit(id);
        break;
      }
      case "delete_leads": {
        const ids = z.array(idSchema).min(1).max(100).parse(input.ids);
        const { error } = await db
          .from("pa_businesses")
          .delete()
          .eq("user_id", user_id)
          .in("id", ids);
        if (error) throw error;
        await audit(null, { count: ids.length });
        break;
      }
      case "verify": {
        const id = idSchema.parse(input.business_id);
        await owned("businesses", id);
        const { count } = await db
          .from("pa_verification_runs")
          .select("id", { count: "exact", head: true })
          .eq("business_id", id)
          .in("status", ["queued", "running"]);
        if (count)
          throw new Error(
            "This lead already has a queued or running verification.",
          );
        result = await insert("verification_runs", { business_id: id });
        await update("businesses", id, {
          verification_status: "Verification in progress",
        });
        await audit(id);
        break;
      }
      case "manual_review": {
        const v = manualSchema.parse(input);
        await owned("businesses", v.business_id);
        const { count: inProgress } = await db
          .from("pa_verification_runs")
          .select("id", { count: "exact", head: true })
          .eq("business_id", v.business_id)
          .in("status", ["queued", "running"]);
        if (inProgress)
          throw new Error(
            "Wait for the queued verification to finish before recording a manual assessment.",
          );
        const age = Date.now() - new Date(v.observed_at).getTime();
        if (age < 0 || age > 90 * 86400000)
          throw new Error(
            "Use an evidence observation date within the last 90 days.",
          );
        if (
          v.website === "no_website_high_confidence" &&
          (!v.second_source ||
            new URL(v.source_url).hostname ===
              new URL(v.second_source).hostname)
        )
          throw new Error(
            "High-confidence website absence requires two independent sources plus an explanation of the search scope.",
          );
        const timestamp = new Date().toISOString();
        const evidence = [
          {
            type: "Manual assessment",
            detail: v.explanation,
            url: v.source_url,
            timestamp,
          },
          { type: "Evidence observed", detail: v.observed_at, timestamp },
          ...(v.second_source
            ? [
                {
                  type: "Independent corroborating source",
                  detail: "Reviewed by workspace user.",
                  url: v.second_source,
                  timestamp,
                },
              ]
            : []),
        ];
        await insert("verification_runs", {
          business_id: v.business_id,
          status: "completed",
          explanation: v.explanation,
          evidence,
          completed_at: timestamp,
        });
        const status =
          v.activity === "closed_inactive"
            ? "Closed or inactive evidence"
            : v.website === "website_found"
              ? "Website found"
              : v.website === "no_website_high_confidence"
                ? "No website found, high confidence"
                : v.activity === "verified_active"
                  ? "Verified active"
                  : "Manual review required";
        result = await update("businesses", v.business_id, {
          activity_status: v.activity,
          website_status: v.website,
          activity_confidence:
            v.activity === "verified_active"
              ? 85
              : v.activity === "closed_inactive"
                ? 75
                : 25,
          website_confidence:
            v.website === "no_website_high_confidence"
              ? 85
              : v.website === "website_found"
                ? 85
                : 20,
          verification_status: status,
        });
        await audit(v.business_id, {
          assessment: "manual",
          explanation: "Reviewer-attested scores. Not automated proof.",
        });
        break;
      }
      case "save_proposal": {
        const v = proposalSchema.parse(input);
        const b = await owned("businesses", v.business_id);
        if (b.activity_status !== "verified_active")
          throw new Error(
            "Verify business activity before creating a proposal.",
          );
        if (v.id) {
          const p = await owned("proposals", v.id);
          if (p.business_id !== v.business_id)
            throw new Error(
              "A proposal cannot be reassigned to another business.",
            );
          result = await update("proposals", v.id, {
            title: v.title,
            content: v.content,
            version: p.version + 1,
          });
        } else
          result = await insert("proposals", {
            business_id: v.business_id,
            title: v.title,
            content: v.content,
            origin: "manual",
          });
        await audit((result as { id: string }).id);
        break;
      }
      case "generate_concept": {
        const business_id = idSchema.parse(input.business_id);
        const regenerate = z
          .boolean()
          .optional()
          .default(false)
          .parse(input.regenerate);
        const proposal_id = input.proposal_id
          ? idSchema.parse(input.proposal_id)
          : null;
        const b = await owned("businesses", business_id);
        if (b.activity_status !== "verified_active")
          throw new Error(
            "Verify business activity before generating a concept.",
          );
        // Regeneration targets only an owned AI concept for this same lead.
        // Workspace/user identity always comes from the verified session.
        let previous: { id: string; version: number } | null = null;
        if (regenerate) {
          if (proposal_id) {
            const p = await owned("proposals", proposal_id);
            if (p.business_id !== business_id || p.origin !== "ai")
              throw new Error(
                "Select a saved AI concept for this business to regenerate.",
              );
            previous = { id: p.id, version: p.version };
          } else {
            const { data, error } = await db
              .from("pa_proposals")
              .select("id,version")
              .eq("user_id", user_id)
              .eq("business_id", business_id)
              .eq("origin", "ai")
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (error)
              throw new Error(
                `Unable to read saved AI concepts: ${error.message}`,
              );
            if (data) previous = { id: data.id, version: data.version };
          }
        }
        const repository: ConceptRepository = {
          insertProposal: async (values) =>
            (await insert("proposals", values)) as StoredConceptProposal,
          updateProposal: async (id, values) =>
            (await update("proposals", id, values)) as StoredConceptProposal,
        };
        result = await generateAndSaveConcept({
          rawLead: b,
          provider: new CompatibleAI(),
          repository,
          previous,
        });
        await audit((result as { proposal: { id: string } }).proposal.id, {
          provider: (result as { provider: string }).provider,
          model: (result as { model: string }).model,
          generated_at: (result as { generated_at: string }).generated_at,
          regenerate,
          facts_schema_version: 1,
        });
        break;
      }
      case "test_provider": {
        const provider = z.enum(healthProviderSchema).parse(input.provider);
        const health = await checkProviderHealth(provider, db);
        const saved = await saveProviderHealth(health);
        await audit(null, {
          provider,
          status: saved.status,
          latency_ms: saved.latency_ms,
        });
        result = saved;
        break;
      }
      case "test_ai": {
        const started = Date.now();
        try {
          const health = await new CompatibleAI().healthCheck();
          const saved = await saveProviderHealth({
            provider: "ai",
            status: "reachable",
            checked_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            latency_ms: health.latencyMs,
            last_error: null,
            recommended_action:
              "AI is reachable. Review generated drafts before using or exporting them.",
          });
          // Keep the model response out of the audit log and provider-health
          // row. It is shown only to the requesting signed-in operator and is
          // not business evidence.
          await audit(null, {
            provider: health.provider,
            model: health.model,
            latency_ms: health.latencyMs,
            status: saved.status,
          });
          result = health;
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "AI provider health check failed.";
          const status = /rate limit|\(429\)/i.test(message)
            ? "rate_limited"
            : "unreachable";
          await saveProviderHealth({
            provider: "ai",
            status,
            checked_at: new Date().toISOString(),
            last_success_at: null,
            latency_ms: Date.now() - started,
            last_error: message.slice(0, 500),
            recommended_action:
              status === "rate_limited"
                ? "Wait for the provider's stated retry window before testing again."
                : "Check the server-only provider key, model, endpoint, and provider status.",
          });
          await audit(null, { provider: "ai", status });
          throw cause;
        }
        break;
      }
      case "save_message": {
        const v = messageSchema.parse(input);
        await owned("businesses", v.business_id);
        const { data: suppression } = await db
          .from("pa_suppression_records")
          .select("id")
          .eq("user_id", user_id)
          .eq("contact", v.recipient.toLowerCase().trim())
          .maybeSingle();
        if (suppression)
          throw new Error(
            "This recipient is on your suppression list. Do not contact them again.",
          );
        const values = {
          business_id: v.business_id,
          channel: v.channel,
          recipient: v.recipient,
          subject: v.subject,
          body: v.body,
          status: "draft",
          approved_at: null,
        };
        if (v.id) {
          await owned("outreach_messages", v.id);
          result = await update("outreach_messages", v.id, values);
        } else result = await insert("outreach_messages", values);
        await audit((result as { id: string }).id);
        break;
      }
      case "approve_message": {
        const id = idSchema.parse(input.id);
        const m = await owned("outreach_messages", id);
        if (m.status === "suppressed")
          throw new Error("Suppressed contacts cannot be approved.");
        const lawful_basis = z
          .string()
          .trim()
          .min(10)
          .max(2000)
          .parse(input.lawful_basis);
        result = await update("outreach_messages", id, {
          status: "approved",
          approved_at: new Date().toISOString(),
          lawful_basis,
        });
        if ((result as { status: string }).status === "suppressed")
          throw new Error("This contact has opted out. Approval blocked.");
        await insert("outreach_events", {
          message_id: id,
          event_type: "approved",
          detail: "Human review; sending remains disabled.",
        });
        break;
      }
      case "send_message":
        return NextResponse.json(
          {
            error:
              "Sending is disabled. No messaging provider is authorised. Approval never sends a message.",
          },
          { status: 403 },
        );
      case "suppress": {
        const contact = z
          .string()
          .trim()
          .min(3)
          .max(200)
          .parse(input.contact)
          .toLowerCase();
        const reason = z.string().trim().min(3).max(500).parse(input.reason);
        const { data: r, error } = await db
          .from("pa_suppression_records")
          .upsert(
            { user_id, contact, reason },
            { onConflict: "user_id,contact" },
          )
          .select()
          .single();
        if (error) throw error;
        result = r;
        await audit(r.id);
        break;
      }
      case "message_event": {
        const id = idSchema.parse(input.message_id);
        await owned("outreach_messages", id);
        result = await insert("outreach_events", {
          message_id: id,
          event_type: z
            .enum(["note", "reply", "follow_up"])
            .parse(input.event_type),
          detail: z.string().trim().min(1).max(2000).parse(input.detail),
        });
        break;
      }
      case "save_settings": {
        const v = settingsSchema.parse(input);
        const { data: r, error } = await db
          .from("pa_integration_settings")
          .upsert({ ...v, user_id }, { onConflict: "user_id" })
          .select()
          .single();
        if (error) throw error;
        result = r;
        await audit(r.id);
        break;
      }
      case "save_profile": {
        const display_name = displayNameSchema.parse(input.display_name);
        const { data: profile, error } = await db
          .from("pa_profiles")
          .upsert({ id: user_id, display_name })
          .select("display_name,updated_at")
          .single();
        if (error) throw error;
        result = profile;
        await audit(user_id, { field: "display_name" });
        break;
      }
      case "purge_expired": {
        const { data: s } = await db
          .from("pa_integration_settings")
          .select("retention_days")
          .eq("user_id", user_id)
          .maybeSingle();
        const before = new Date(
          Date.now() - (s?.retention_days || 90) * 86400000,
        ).toISOString();
        const { error, count } = await db
          .from("pa_businesses")
          .delete({ count: "exact" })
          .eq("user_id", user_id)
          .lt("created_at", before);
        if (error) throw error;
        result = { deleted: count };
        await audit(null, { before, count });
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json(result, { headers: rateLimitHeaders(rate) });
  } catch (e) {
    if (e instanceof AIProviderError)
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    if (e instanceof z.ZodError) {
      const labels: Record<string, string> = {
        type: "Action",
        business_id: "Business",
        message_id: "Draft",
        display_name: "Display name",
        max_results: "Maximum results",
      };
      const errors = e.issues.map((issue) => {
        const path = String(issue.path[0] || "");
        if (!path)
          return "Your request is incomplete or invalid. Refresh and try again.";
        const label = labels[path] || path.replaceAll("_", " ");
        return `${label}: ${issue.message.replace(/^Invalid input:\s*/i, "")}`;
      });
      return NextResponse.json(
        { error: [...new Set(errors)].join("; ") },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed. Try again." },
      { status: 400 },
    );
  }
}
