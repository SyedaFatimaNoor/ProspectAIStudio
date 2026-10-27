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
} from "@/lib/validation";
import { CompatibleAI } from "@/lib/ai";
import {
  pausedCloudWorkerMessage,
  workerIsKnownPaused,
} from "@/lib/cloud-worker";
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
    const input = JSON.parse(raw);
    const type = z.string().parse(input.type);
    const user_id = user.id;
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
    let result: unknown = { ok: true };
    switch (type) {
      case "create_job": {
        if (!process.env.OVERPASS_URL)
          return NextResponse.json(
            {
              error:
                "No discovery source is configured. Set OVERPASS_URL on the server after reviewing the provider policy. No search was run.",
            },
            { status: 409 },
          );
        // A missing status function is intentionally not treated as a failure:
        // self-hosted deployments may use a separate worker. An explicit pause,
        // however, must reject direct API calls as well as the disabled UI.
        const { data: worker, error: workerStatusError } = await db.rpc(
          "pa_cloud_worker_status",
        );
        if (!workerStatusError && workerIsKnownPaused(worker))
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
          .in("status", ["queued", "running"]);
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
        if (status === "queued" && !["paused", "failed"].includes(j.status))
          throw new Error("Only paused or failed jobs can be resumed.");
        if (status === "queued") {
          const { data: worker, error: workerStatusError } = await db.rpc(
            "pa_cloud_worker_status",
          );
          if (!workerStatusError && workerIsKnownPaused(worker))
            throw new Error(pausedCloudWorkerMessage);
        }
        if (status === "paused" && !["queued", "running"].includes(j.status))
          throw new Error("Only queued or running jobs can be paused.");
        result = await update("discovery_jobs", id, {
          status,
          ...(status === "queued"
            ? { attempts: 0, next_retry_at: new Date().toISOString() }
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
        const b = await owned("businesses", idSchema.parse(input.business_id));
        if (b.activity_status !== "verified_active")
          throw new Error(
            "Verify business activity before generating a concept.",
          );
        const content = await new CompatibleAI().generateConcept({
          name: b.name,
          category: b.category,
          city: b.city,
          country: b.country,
        });
        result = { content };
        await audit(b.id);
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
        const display_name = z
          .string()
          .trim()
          .min(1)
          .max(80)
          .parse(input.display_name);
        const { error } = await db
          .from("pa_profiles")
          .upsert({ id: user_id, display_name });
        if (error) throw error;
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
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed. Try again." },
      { status: 400 },
    );
  }
}
