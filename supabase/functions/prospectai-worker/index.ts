import {
  discoverOsmSnapshot,
  discoverOpenStreetMap,
  parseCloudSearch,
} from "../../../src/lib/discovery-core";
import type {
  SearchInput,
  DiscoveredBusiness,
} from "../../../src/lib/discovery";
import { snapshotReadiness } from "../../../src/lib/source-readiness";
import {
  boundedResponseTime,
  classifyWorkerFailure,
  cloudWorkerVersion,
  safeWorkerFailureDetail,
  workerSource,
} from "../../../src/lib/worker-lifecycle";

// Native Web APIs only: single-file connector deployments must not depend on
// runtime npm/GitHub imports. No credentials are ever bundled into this file.
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
type Dependencies = {
  env: Environment;
  database?: () => Database;
  provider?: {
    discover(
      input: SearchInput,
      signal?: AbortSignal,
    ): Promise<DiscoveredBusiness[]>;
  };
};
export async function validWorkerToken(
  expected: string,
  supplied: string | null,
) {
  if (!supplied || expected.length < 32 || supplied.length > 256) return false;
  // WebCrypto verifies the MAC in constant time. No Node crypto import or
  // JavaScript string comparison of secrets in the Edge runtime.
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const encode = (v: string) => new TextEncoder().encode(v);
  const message = encode("ProspectAI cloud scheduler authentication v1");
  const key = await crypto.subtle.importKey(
    "raw",
    encode(expected),
    algorithm,
    false,
    ["verify"],
  );
  const candidate = await crypto.subtle.importKey(
    "raw",
    encode(supplied),
    algorithm,
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", candidate, message);
  return crypto.subtle.verify("HMAC", key, signature, message);
}
function databaseClient(env: Environment, deadline: AbortSignal): Database {
  const base = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key || new URL(base).protocol !== "https:")
    throw new Error("Database is not configured");
  return {
    async rpc(name, args = {}) {
      const response = await fetch(
        `${base.replace(/\/$/, "")}/rest/v1/rpc/${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(args),
          signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
        },
      );
      const data: unknown = await response.json();
      return response.ok
        ? { data, error: null }
        : {
            data: null,
            error: {
              message:
                typeof data === "object" && data && "message" in data
                  ? String(data.message).slice(0, 500)
                  : `Database HTTP ${response.status}`,
            },
          };
    },
  };
}
function claim(value: unknown): {
  token: string;
  job: Record<string, unknown> & { id: string; provider: string };
} {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !value ||
    typeof value !== "object" ||
    !("token" in value) ||
    !("job" in value) ||
    typeof value.token !== "string" ||
    !uuid.test(value.token) ||
    !value.job ||
    typeof value.job !== "object" ||
    !("id" in value.job) ||
    typeof value.job.id !== "string" ||
    !uuid.test(value.job.id) ||
    !("provider" in value.job) ||
    typeof value.job.provider !== "string"
  )
    throw new Error("Invalid worker claim");
  return {
    token: value.token,
    job: value.job as Record<string, unknown> & {
      id: string;
      provider: string;
    },
  };
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
    if (expected.length < 32)
      return reply({ error: "Worker authentication is not configured" }, 503);
    if (
      !(await validWorkerToken(expected, request.headers.get("x-worker-token")))
    )
      return reply({ error: "Unauthorized" }, 401);
    const snapshot = env.get("PA_OSM_SNAPSHOT") === "1";
    const endpoint = env.get("PA_OVERPASS_URL");
    if (!snapshot && !endpoint)
      return reply({ error: "Provider is not configured" }, 503);
    let url: URL | null = null;
    if (!snapshot && endpoint) {
      try {
        url = new URL(endpoint);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("HTTPS required");
      } catch {
        return reply({ error: "Invalid configured provider URL" }, 503);
      }
    }
    const deadline = AbortSignal.timeout(80000);
    let db: Database;
    try {
      db = database ? database() : databaseClient(env, deadline);
    } catch {
      return reply({ error: "Worker database configuration is missing" }, 503);
    }
    const source = workerSource(snapshot, url?.toString());
    try {
      const heartbeat = await db.rpc("pa_cloud_heartbeat", {
        p_source: source,
        p_worker_version: cloudWorkerVersion,
      });
      if (heartbeat.error)
        return reply({ error: "Worker health could not be recorded" }, 503);
    } catch {
      return reply({ error: "Worker health could not be recorded" }, 503);
    }
    if (snapshot) {
      // Check aggregate readiness before claiming. An enabled snapshot flag alone
      // does not prove it contains source rows, and an empty source must never
      // turn a queued discovery into an empty completed result.
      try {
        const { data, error } = await db.rpc("pa_osm_snapshot_status");
        if (error)
          return reply(
            {
              error:
                "OpenStreetMap snapshot readiness could not be verified. No job was claimed; keep scheduling paused.",
            },
            503,
          );
        const readiness = snapshotReadiness(data);
        if (!readiness.ready) {
          const reason =
            readiness.message ||
            "The OpenStreetMap snapshot is not ready for discovery. No job was claimed.";
          const paused = await db.rpc("pa_cloud_pause_source", {
            p_error: reason,
          });
          if (paused.error)
            console.error(
              JSON.stringify({
                event: "cloud_source_pause_failed",
                error_category: "database_error",
              }),
            );
          return reply(
            {
              error:
                "OpenStreetMap snapshot is not ready. No job was claimed; scheduling is paused pending source setup.",
            },
            503,
          );
        }
      } catch {
        return reply(
          {
            error:
              "OpenStreetMap snapshot readiness could not be verified. No job was claimed; keep scheduling paused.",
          },
          503,
        );
      }
    }
    let claimed: ReturnType<typeof claim> | null = null;
    let sourceRequestStarted: number | null = null;
    try {
      // Request body is ignored: only the DB can select a tenant/job under a lease.
      const { data, error } = await db.rpc("pa_cloud_claim", {
        p_source: source,
        p_worker_version: cloudWorkerVersion,
      });
      if (error) throw new Error(error.message);
      if (!data) return reply({ idle: true });
      claimed = claim(data);
      const job = claimed.job;
      if (job.provider !== "openstreetmap")
        throw new Error("Unsupported discovery provider");
      const input = parseCloudSearch(job);
      sourceRequestStarted = performance.now();
      const rows = provider
        ? await provider.discover(input, deadline)
        : snapshot
          ? await discoverOsmSnapshot(
              input,
              (name, args) => db.rpc(name, args),
              deadline,
            )
          : await discoverOpenStreetMap(input, url!.toString(), deadline);
      const responseTime = boundedResponseTime(sourceRequestStarted);
      if (deadline.aborted) throw new Error("Worker deadline exceeded");
      const committed = await db.rpc("pa_cloud_commit", {
        p_job: job.id,
        p_token: claimed.token,
        p_rows: rows,
        p_response_time_ms: responseTime,
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
      const effectiveError = deadline.aborted
        ? new Error("Worker deadline exceeded")
        : error;
      const failure = classifyWorkerFailure(effectiveError);
      const message = safeWorkerFailureDetail(effectiveError, failure);
      const responseTime =
        sourceRequestStarted === null
          ? null
          : boundedResponseTime(sourceRequestStarted);
      if (claimed) {
        try {
          const failed = await db.rpc("pa_cloud_fail", {
            p_job: claimed.job.id,
            p_token: claimed.token,
            p_error: message,
            p_error_category: failure.category,
            p_response_time_ms: responseTime,
            p_worker_version: cloudWorkerVersion,
          });
          if (failed.error) throw new Error("Failure logging unavailable");
        } catch {
          console.error(
            JSON.stringify({
              event: "cloud_failure_recording_failed",
              error_category: "database_error",
            }),
          );
        }
      }
      console.error(
        JSON.stringify({
          event: "cloud_worker_failed",
          error_category: failure.category,
          http_status: failure.httpStatus,
        }),
      );
      return reply(
        {
          error:
            "Discovery attempt failed. See job logs; retries are limited to safe transient errors.",
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
