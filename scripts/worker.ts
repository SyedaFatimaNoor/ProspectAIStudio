// Separate bounded worker. No browser automation, scraping, or messaging is performed.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { setTimeout as delay } from "node:timers/promises";
import {
  getProvider,
  isDuplicate,
  type DiscoveredBusiness,
} from "../src/lib/discovery";
import { jobSchema } from "../src/lib/validation";
import { verifyBusiness } from "../src/lib/verification";
import type { Business } from "../src/lib/types";
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Worker requires NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY. No work performed.",
  );
  process.exit(1);
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let stopping = false;
const controller = new AbortController();
process.on("SIGTERM", () => {
  stopping = true;
  controller.abort();
});
process.on("SIGINT", () => {
  stopping = true;
  controller.abort();
});
function log(event: string, detail: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), event, ...detail }),
  );
}
async function must<T extends { error: unknown }>(operation: PromiseLike<T>) {
  const r = await operation;
  if (r.error)
    throw new Error(
      (r.error as { message?: string }).message || "Database operation failed.",
    );
  return r;
}
async function discovery() {
  await must(
    db
      .from("pa_discovery_jobs")
      .update({
        status: "failed",
        error:
          "Worker lease expired after the maximum number of attempts. Resume to retry.",
        lease_until: null,
      })
      .eq("status", "running")
      .gte("attempts", 3)
      .lt("lease_until", new Date().toISOString()),
  );
  const { data } = await must(db.rpc("pa_claim_job"));
  const job = data?.[0];
  if (!job) return false;
  const logs: string[] = job.logs || [];
  const add = (text: string) => {
    logs.push(`${new Date().toISOString()} ${text}`);
    log("discovery", { job: job.id, message: text });
  };
  try {
    add("Claimed a two-minute lease. Querying configured public source.");
    await must(db.from("pa_discovery_jobs").update({ logs }).eq("id", job.id));
    const rows = await getProvider(job.provider).discover(
      jobSchema.parse(job),
      controller.signal,
    );
    add(
      `Provider returned ${rows.length} matching public listings. These are unverified records.`,
    );
    await must(
      db
        .from("pa_discovery_jobs")
        .update({ total: rows.length, logs })
        .eq("id", job.id)
        .eq("status", "running"),
    );
    const { data: existing } = await must(
      db.from("pa_businesses").select("*").eq("user_id", job.user_id),
    );
    const known = (existing || []) as (DiscoveredBusiness & { id?: string })[];
    let processed = 0;
    for (const row of rows) {
      if (stopping)
        throw new Error("Worker shutting down. Job will be retried.");
      const { data: current } = await must(
        db.from("pa_discovery_jobs").select("status").eq("id", job.id).single(),
      );
      if (!current || current.status !== "running") {
        add(`Stopped gracefully: ${current?.status || "deleted"}.`);
        await must(
          db
            .from("pa_discovery_jobs")
            .update({ logs, lease_until: null })
            .eq("id", job.id),
        );
        return true;
      }
      let record = known.find((b) => isDuplicate(row, b));
      if (!record) {
        const inserted = await db
          .from("pa_businesses")
          .upsert(
            { ...row, user_id: job.user_id, job_id: job.id },
            {
              onConflict: "user_id,provider,source_id",
              ignoreDuplicates: true,
            },
          )
          .select()
          .maybeSingle();
        if (inserted.error && inserted.error.code !== "23505")
          throw inserted.error;
        if (inserted.data) record = inserted.data;
        else {
          const { data: collision } = await must(
            db
              .from("pa_businesses")
              .select("*")
              .eq("user_id", job.user_id)
              .eq("fingerprint", row.fingerprint)
              .maybeSingle(),
          );
          record = collision || undefined;
          if (!record) {
            const { data: sameSource } = await must(
              db
                .from("pa_businesses")
                .select("*")
                .eq("user_id", job.user_id)
                .eq("provider", row.provider)
                .eq("source_id", row.source_id)
                .maybeSingle(),
            );
            record = sameSource || undefined;
          }
        }
        if (record) known.push(record);
      }
      // Reconcile provenance even on a resumed job that inserted the business before crashing.
      if (record?.id) {
        await must(
          db.from("pa_business_sources").upsert(
            {
              business_id: record.id,
              user_id: job.user_id,
              url: row.source_url,
              provider: row.provider,
              data: row.facts,
            },
            {
              onConflict: "business_id,provider,url",
              ignoreDuplicates: true,
            },
          ),
        );
        if (job.requirements.website_review) {
          const { count } = await must(
            db
              .from("pa_verification_runs")
              .select("id", { count: "exact", head: true })
              .eq("business_id", record.id),
          );
          if (!count) {
            const queued = await db
              .from("pa_verification_runs")
              .insert({ business_id: record.id, user_id: job.user_id });
            if (queued.error && queued.error.code !== "23505")
              throw queued.error;
          }
        }
      }
      processed++;
      await must(
        db
          .from("pa_discovery_jobs")
          .update({
            processed,
            logs,
            lease_until: new Date(Date.now() + 120000).toISOString(),
          })
          .eq("id", job.id)
          .eq("status", "running"),
      );
    }
    add(`Completed. ${processed} source records reviewed; duplicates skipped.`);
    await must(
      db
        .from("pa_discovery_jobs")
        .update({
          status: "completed",
          processed,
          logs,
          error: null,
          lease_until: null,
        })
        .eq("id", job.id)
        .eq("status", "running"),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    add(`Attempt ${job.attempts} failed: ${message}`);
    await must(
      db
        .from("pa_discovery_jobs")
        .update({
          status: job.attempts >= 3 ? "failed" : "queued",
          error: message,
          logs,
          lease_until: null,
          next_retry_at: new Date(
            Date.now() + Math.min(300000, 30000 * 2 ** job.attempts),
          ).toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "running"),
    );
  }
  return true;
}
async function verification() {
  await must(
    db
      .from("pa_verification_runs")
      .update({
        status: "failed",
        error: "Worker lease expired after the maximum number of attempts.",
        lease_until: null,
      })
      .eq("status", "running")
      .gte("attempts", 3)
      .lt("lease_until", new Date().toISOString()),
  );
  const { data: runs } = await must(
    db
      .from("pa_verification_runs")
      .select("*")
      .or(
        `status.eq.queued,and(status.eq.running,lease_until.lt.${new Date().toISOString()})`,
      )
      .lt("attempts", 3)
      .order("created_at")
      .limit(1),
  );
  const run = runs?.[0];
  if (!run) return false;
  const { data: claimed } = await must(
    db
      .from("pa_verification_runs")
      .update({
        status: "running",
        attempts: run.attempts + 1,
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })
      .eq("id", run.id)
      .eq("status", run.status)
      .eq("attempts", run.attempts)
      .select()
      .maybeSingle(),
  );
  if (!claimed) return true;
  try {
    const { data: b } = await must(
      db.from("pa_businesses").select("*").eq("id", run.business_id).single(),
    );
    const result = await verifyBusiness(b as Business);
    await must(db.from("pa_website_candidates").delete().eq("run_id", run.id));
    for (const c of result.candidates)
      await must(
        db.from("pa_website_candidates").insert({
          user_id: run.user_id,
          business_id: run.business_id,
          run_id: run.id,
          ...c,
        }),
      );
    const { evidence, explanation, candidates: _, ...assessment } = result;
    await must(
      db.from("pa_businesses").update(assessment).eq("id", run.business_id),
    );
    await must(
      db
        .from("pa_verification_runs")
        .update({
          status: "completed",
          evidence,
          explanation,
          completed_at: new Date().toISOString(),
          lease_until: null,
          error: null,
        })
        .eq("id", run.id),
    );
    log("verification_completed", { run: run.id, business: run.business_id });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await must(
      db
        .from("pa_verification_runs")
        .update({
          status: run.attempts >= 2 ? "failed" : "queued",
          error,
          lease_until: null,
        })
        .eq("id", run.id),
    );
    if (run.attempts >= 2)
      await must(
        db
          .from("pa_businesses")
          .update({ verification_status: "Verification failed" })
          .eq("id", run.business_id),
      );
    log("verification_failed", { run: run.id, error });
  }
  return true;
}
let lastCleanup = 0;
async function cleanup() {
  if (Date.now() - lastCleanup < 86400000) return;
  lastCleanup = Date.now();
  const { data: removed } = await must(db.rpc("pa_purge_expired"));
  log("retention_cleanup", { removed });
}
async function main() {
  log("worker_started");
  while (!stopping) {
    try {
      await cleanup();
      const worked = await discovery();
      if (!stopping) await verification();
      await delay(worked ? 10000 : 5000);
    } catch (e) {
      log("worker_error", {
        error: e instanceof Error ? e.message : String(e),
      });
      await delay(10000);
    }
  }
  log("worker_stopped");
}
void main();
