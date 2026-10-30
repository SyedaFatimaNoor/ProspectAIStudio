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
// Claiming is scoped to one account on purpose. The pa_claim_job() RPC is a
// security-definer function that returns the oldest eligible job in the whole
// database, so running this locally with the service key would process other
// people's production jobs and spend their retry budget.
const claimUser = process.argv
  .find((a) => a.startsWith("--user="))
  ?.slice("--user=".length);
if (!claimUser || !/^[0-9a-f-]{36}$/i.test(claimUser)) {
  console.error(
    "Worker requires --user=<uuid> and only claims that account's jobs. An unscoped worker would run other users' production jobs. Usage: npm run worker -- --user=<uuid>",
  );
  process.exit(1);
}
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
// A country-wide extract parse costs minutes, and a dropped uplink response must
// not throw that work away. Builders re-issue their request when awaited again.
const transientNetwork =
  /fetch failed|Connect Timeout|ECONNRESET|ETIMEDOUT|socket hang up|UND_ERR/i;
async function must<T extends { error: unknown }>(operation: PromiseLike<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await operation;
      if (r.error)
        throw new Error(
          (r.error as { message?: string }).message ||
            "Database operation failed.",
        );
      return r;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt >= 3 || !transientNetwork.test(message)) throw e;
      await delay(1200 * attempt);
    }
  }
}
// A country-wide .osm.pbf scan can outlast the two-minute lease meant for HTTP
// sources; an expired lease lets the sweep re-claim the same job and re-parse it.
const discoveryLeaseMs = process.env.OSM_EXTRACT_PATH ? 900000 : 120000;
async function discovery() {  await must(
    db
      .from("pa_discovery_jobs")
      .update({
        status: "failed",
        error:
          "Worker lease expired after the maximum number of attempts. Resume to retry.",
        lease_until: null,
      })
      .eq("status", "running")
      .eq("user_id", claimUser)
      .gte("attempts", 3)
      .lt("lease_until", new Date().toISOString()),
  );
  const { data: candidates } = await must(
    db
      .from("pa_discovery_jobs")
      .select("*")
      .eq("user_id", claimUser)
      .or(
        `status.eq.queued,and(status.eq.running,lease_until.lt.${new Date().toISOString()})`,
      )
      .lt("attempts", 3)
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at")
      .limit(1),
  );
  const found = candidates?.[0];
  if (!found) return false;
  // Compare-and-swap, matching the verification claim below: these guards
  // re-check what we just read, so if the cloud tick took the row first this
  // update matches nothing and we yield instead of double-processing a job.
  const { data: job } = await must(
    db
      .from("pa_discovery_jobs")
      .update({
        status: "running",
        attempts: found.attempts + 1,
        lease_until: new Date(Date.now() + discoveryLeaseMs).toISOString(),
      })
      .eq("id", found.id)
      .eq("user_id", claimUser)
      .eq("status", found.status)
      .eq("attempts", found.attempts)
      .select()
      .maybeSingle(),
  );
  if (!job) return false;
  const logs: string[] = job.logs || [];
  const add = (text: string) => {
    logs.push(`${new Date().toISOString()} ${text}`);
    log("discovery", { job: job.id, message: text });
  };
  try {
    add(
      `Claimed a ${discoveryLeaseMs / 60000}-minute lease. Querying configured public source.`,
    );
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
        // A dropped uplink response surfaces as an error object without a code,
        // so retry it; a unique violation is resolved by the lookups below.
        for (let attempt = 1; ; attempt++) {
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
          if (!inserted.error) {
            if (inserted.data) record = inserted.data;
            break;
          }
          if (inserted.error.code === "23505") break;
          const message = `${
            (inserted.error as { message?: string }).message || "Insert failed"
          }${inserted.error.code ? ` (${inserted.error.code})` : ""}`;
          if (attempt < 3 && transientNetwork.test(message)) {
            await delay(1200 * attempt);
            continue;
          }
          throw new Error(`Saving ${row.name} failed: ${message}`);
        }
      }
      if (!record) {
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
            for (let attempt = 1; ; attempt++) {
              const queued = await db
                .from("pa_verification_runs")
                .insert({ business_id: record.id, user_id: job.user_id });
              if (!queued.error) break;
              if (queued.error.code === "23505") break;
              const message = `${
                (queued.error as { message?: string }).message ||
                "Queueing website review failed"
              }${queued.error.code ? ` (${queued.error.code})` : ""}`;
              if (attempt < 3 && transientNetwork.test(message)) {
                await delay(1200 * attempt);
                continue;
              }
              throw new Error(
                `Queueing website review for ${row.name} failed: ${message}`,
              );
            }
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
            lease_until: new Date(Date.now() + discoveryLeaseMs).toISOString(),
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
      .eq("user_id", claimUser)
      .gte("attempts", 3)
      .lt("lease_until", new Date().toISOString()),
  );
  const { data: runs } = await must(
    db
      .from("pa_verification_runs")
      .select("*")
      .eq("user_id", claimUser)
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
