import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { OpenStreetMapProvider } from "../../../src/lib/discovery";
import { jobSchema } from "../../../src/lib/validation";

// Built into a single ESM file for connector/CLI deployment. Never includes keys.
// No business URL fetches, AI calls, email delivery, or browser automation here.
type Environment = { get(name: string): string | undefined };
type Database = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};
const claimSchema = z.object({
  token: z.uuid(),
  job: z.object({ id: z.uuid(), provider: z.string() }).passthrough(),
});
type Dependencies = {
  env: Environment;
  database?: () => Database;
  provider?: Pick<OpenStreetMapProvider, "discover">;
};
export function validWorkerToken(expected: string, supplied: string | null) {
  if (!supplied || expected.length < 32 || supplied.length > 256) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createWorkerHandler({ env, database, provider }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const reply = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    if (request.method !== "POST")
      return reply({ error: "POST required" }, 405);
    const expected = env.get("PA_WORKER_TOKEN") || "";
    if (!expected || expected.length < 32)
      return reply({ error: "Worker authentication is not configured" }, 503);
    if (!validWorkerToken(expected, request.headers.get("x-worker-token")))
      return reply({ error: "Unauthorized" }, 401);

    // Caller input is intentionally ignored. Only the database can select a job
    // and its tenant, subject to the global lease, cooldown and daily budget.
    const endpoint = env.get("PA_OVERPASS_URL");
    if (!endpoint) return reply({ error: "Provider is not configured" }, 503);
    let url: URL;
    try {
      url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("HTTPS endpoint required");
    } catch {
      return reply({ error: "Invalid configured provider URL" }, 503);
    }
    let db: Database;
    const deadline = AbortSignal.timeout(80000);
    try {
      db = database
        ? database()
        : createClient(
            env.get("SUPABASE_URL") || "",
            env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            {
              auth: { persistSession: false, autoRefreshToken: false },
              global: {
                fetch: (input, init) =>
                  fetch(input, {
                    ...init,
                    signal: AbortSignal.any([
                      deadline,
                      AbortSignal.timeout(20000),
                      ...(init?.signal ? [init.signal] : []),
                    ]),
                  }),
              },
            },
          );
    } catch {
      return reply({ error: "Worker database configuration is missing" }, 503);
    }
    let claimed: {
      token: string;
      job: { id: string; provider: string };
    } | null = null;
    try {
      const { data, error } = await db.rpc("pa_cloud_claim");
      if (error) throw new Error(error.message);
      if (!data) return reply({ idle: true });
      claimed = claimSchema.parse(data);
      const job = claimed.job;
      if (job.provider !== "openstreetmap")
        throw new Error("Unsupported discovery provider");
      const rows = await (
        provider || new OpenStreetMapProvider(url.toString())
      ).discover(jobSchema.parse(job), deadline);
      if (deadline.aborted) throw new Error("Worker deadline exceeded");
      const committed = await db.rpc("pa_cloud_commit", {
        p_job: job.id,
        p_token: claimed.token,
        p_rows: rows,
      });
      if (committed.error) throw new Error(committed.error.message);
      console.info(
        JSON.stringify({
          event: "cloud_discovery",
          job: job.id,
          result: committed.data,
        }),
      );
      return reply({ result: committed.data, mode: "listing-only" });
    } catch (error) {
      // No request headers, environment values or business contacts in logs.
      const message = (
        error instanceof Error ? error.message : "Worker failed"
      ).slice(0, 500);
      if (claimed) {
        const failed = await db.rpc("pa_cloud_fail", {
          p_job: claimed.job.id,
          p_token: claimed.token,
          p_error: message,
        });
        if (failed.error)
          console.error(
            "Cloud failure could not be recorded; lease recovery will retry.",
          );
      }
      console.error(
        JSON.stringify({ event: "cloud_worker_failed", error: message }),
      );
      return reply(
        {
          error: "Discovery attempt failed. See job logs; retries are bounded.",
        },
        502,
      );
    }
  };
}

declare const Deno: {
  env: Environment;
  serve(handler: (request: Request) => Promise<Response>): unknown;
};
if (typeof Deno !== "undefined")
  Deno.serve(createWorkerHandler({ env: Deno.env }));
