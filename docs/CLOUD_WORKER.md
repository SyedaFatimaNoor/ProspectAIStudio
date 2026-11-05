# Bounded cloud discovery (Supabase free-tier-oriented)

The Next.js website remains on Vercel. A separate **Supabase Edge Function** processes real queued discovery jobs; Vercel does not run `npm run worker` automatically. No new project, paid subscription, compute upgrade, or paid add-on is required by this implementation. Existing account billing and usage still apply.

## What runs

- Supabase `pg_cron` checks due work every **5 minutes**. `pg_net` invokes the private Edge Function only when a discovery job is due. Empty queues do not consume Edge invocations.
- One discovery job per invocation, at most 100 results, 3 MB source response, 45-second Overpass request, and 80-second overall request deadline. The SQL RPC commits all results in one transaction. An incomplete response is an error, not a successful empty search.
- Project-wide lease and cooldown: at most one source query at a time, at least five minutes between attempts, **20 attempts per UTC day** maximum. Retries consume the same budget. Every claim records a source marker, worker version, start time, and heartbeat; completion records response duration, source result count, and reconciled duplicate count. Three attempts per job apply only to safe transport/time-out/temporary-provider failures and 429 rate limits. Permanent HTTP 400/401/403/404/405/**406**/410/422 rejections become `blocked` and pause scheduling for operator review, without mirror rotation or bypass. Expired leases recover at the next eligible tick. Jobs beyond the daily cap remain queued until the next UTC day.
- Tenant owner comes from the claimed database job, never a request payload. Atomic job locking rechecks pause/cancel/delete before result writes. The claim token is consumed on commit; a replay cannot duplicate writes. Source IDs/fingerprints and conservative same-name/contact/domain checks reconcile duplicates, with provenance preserved.
- **Listing-only review.** The cloud worker never fetches arbitrary business URLs. This avoids weakening the Node worker's DNS-pinned SSRF protections in an Edge runtime. Evidence states exactly what was observed and what was NOT checked. Newly reviewed listings get independent 20/100 review aids and **Manual review required**, never verified-active/no-website claims. Existing human assessments are preserved. Up to five explicitly queued evidence reviews are resolved with the same source-only scope per cron tick.
- Retention cleanup runs once per UTC day when enabled, using the existing tenant retention preferences.
- No automatic AI generation or messaging. Outreach remains draft-only.

The long-running Node worker remains available for DNS-pinned website HEAD checks on a suitable server. **Use either cloud mode or the Node worker, not both concurrently.** They share queue leases, but the Node process is not governed by the cloud daily budget.

## Deployment and credentials

1. Apply the existing cloud-worker migrations in order, then apply `202611050004_worker_lifecycle_and_health.sql`. It installs existing-project extensions, service-only RPCs, an RLS-protected control table, a disabled-by-default cron dispatcher, and durable lifecycle/health telemetry.
2. Generate a cryptographically random 32-byte scheduler token. Store it in Supabase Vault as `pa_cloud_worker_token` and in Edge Function secrets as `PA_WORKER_TOKEN`. Do not put it in source, cron command text, `.env.example`, the browser, or Vercel public env.
3. Set Edge Function secret `PA_OVERPASS_URL` to an explicitly permitted HTTPS endpoint after reviewing its policy. Current setup uses `https://overpass-api.de/api/interpreter`. Public Overpass has resource/load limits, **not** a contractual free quota. Do not add endpoint rotation to evade rate limits.
4. `npm ci && npm run build:worker`. The tracked `supabase/functions/prospectai-worker/bundle.js` is a deliberately published, reproducible **secret-free** deployment artifact. It includes the shared portable source adapter and strict bounded-response/job validators. It uses only native Web APIs and has **no runtime npm, Node, or GitHub imports**. The build fails if any external import remains.
5. Deploy `prospectai-worker` with the **contents** of that bundle as its entrypoint, with JWT verification disabled. Do not use a remote-import loader: the connector deployment does not bundle those dependencies, and a runtime remote import can fail with `BOOT_ERROR`. The deployed source must match the tracked artifact; check both hashes before enabling the scheduler. A function marked ACTIVE is not proof it boots—make an authenticated readiness call while the scheduler is disabled and expect `{ "idle": true }`.
6. `verify_jwt=false` is intentional: the function instead requires a constant-time checked, private `x-worker-token`. No unauthenticated request can reach the database/provider. Do not remove that check. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into the Edge runtime; neither goes into browser code or cron headers. Rotate any credentials previously exposed in chat before continuing production use.
7. After transactional tests and a deployment readiness check, enable the singleton control row. Existing queued jobs are preserved; no new accounts or synthetic production leads are created.

The migration's scheduler URL targets the application's existing Supabase project. Change it deliberately if deploying to another project.

## Lifecycle and health

The durable worker lifecycle is `configured`, `reachable`, `queued`, `running`, `completed`, `failed`, `blocked`, `paused`, or `rate_limited`. `pa_cloud_worker_status()` is aggregate-only for authenticated workspace users: it never returns a scheduler token, tenant ID, query text, endpoint path, contact data, or source rows. Settings shows the last heartbeat, paused/running state, safe source marker, worker version, last successful and failed job summaries, and last provider error.

A `rate_limited` job waits for its database retry time and cannot be manually resumed early. A `blocked` job, including HTTP 406, has no automatic retry and disables the hosted scheduler. Review the provider's permission/setup first; do not rotate endpoints, alter identity to evade controls, or re-enable the scheduler merely to test repeatedly. An operator may explicitly resume a reviewed blocked job only after the source issue is resolved.

## Free snapshot source (no endpoint, no key, works on serverless)

OpenStreetMap is an open database (ODbL), so a bounded country snapshot may be stored and re-served with attribution. This removes the Overpass dependency entirely: the search reads the workspace database, so there is no outbound provider request for an endpoint to reject, and no large file for a serverless runtime to carry.

1. Apply `202610300001_osm_snapshot.sql` (`pa_osm_places`, `pa_osm_businesses`, `pa_osm_search`, load RPCs, `pa_osm_snapshot_status`).
2. Download the country `.osm.pbf` from `https://download.geofabrik.de` into `.osm-cache/` (gitignored) and verify its published `.md5`.
3. `npm run osm:snapshot -- --file=.osm-cache/<country>.osm.pbf --country='<country name as users type it>' --source-url='https://download.geofabrik.de/<region>/<country>-latest.osm.pbf' --load` parses the local extract and upserts it through service-role RPCs. Add `--dataset-timestamp='<ISO-8601 publication time>'` only when the upstream extract supplies one. The parse takes minutes and stays on the operator's machine; the key never leaves it.
4. The loader validates source identities and records the source name, exact HTTPS source URL, ODbL attribution, optional dataset timestamp, imported record counts, and last successful import time. It does not download, scrape, seed, or fabricate listings. Re-running the same source is idempotent: businesses upsert by typed OSM element ID (`node/<id>`, `way/<id>`, or `relation/<id>`), so numeric IDs from different element types remain distinct.
5. Set Edge Function secret `PA_OSM_SNAPSHOT=1` (replaces the `PA_OVERPASS_URL` requirement) and app/worker environment `OSM_SNAPSHOT=1`. Snapshot selection takes precedence over `OSM_EXTRACT_PATH`.
6. Re-run `tests/osm-snapshot.sql`. The application and Edge worker both verify aggregate snapshot readiness before allowing or claiming a job: **both** place and business counts must be non-zero, and the import must be marked `ready`. An empty, loading, failed, or unreadable snapshot blocks new jobs; the worker pauses scheduling before it can claim an existing job. Apply `202611050002_cloud_source_readiness.sql` and `202611050003_osm_snapshot_import_metadata.sql` together with the matching worker bundle before relying on that guard.
7. Only after the snapshot status shows imported data, a recorded successful import time, and the worker readiness call succeeds may an authorised operator consider enabling the singleton row (operator SQL below).

A snapshot is a dated copy, so each result carries `source_format: OpenStreetMap snapshot record dated <date>` and the job stays listing-only. The record date is distinct from an upstream dataset timestamp, which is reported only when the extract publisher provides it. Refresh deliberately; `pa_osm_snapshot_status()` reports source provenance, record counts, import state, optional upstream dataset timestamp, and last successful import time so an old copy cannot be mistaken for live data. City scoping is a place hierarchy (a city plus its smaller places within a rank-based radius), so a listing in one city cannot appear in another city's search.

## Operator commands (SQL editor; not browser-accessible)

```sql
-- Health without secrets or other tenants' job details:
select public.pa_cloud_worker_status();

-- Pause NEW cloud work. In-flight work may finish; cancel the job to prevent its commit.
update public.pa_cloud_worker set enabled=false where singleton;

-- Enable:
update public.pa_cloud_worker set enabled=true where singleton;

-- Optional immediate check. It still honors cooldown, active lease, daily cap, and idle checks:
select public.pa_cloud_tick();

-- Scheduler executions:
select status, return_message, start_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='prospectai-cloud-worker')
order by start_time desc limit 10;
```

A successful cron SQL execution only means the dispatcher ran. Inspect the job logs, Edge response, and `last_finished_at` to establish actual source execution. `net._http_response` contains the asynchronous Edge response; do not expose it to browser users. Monitor database size, egress, and Edge quotas in the Supabase dashboard. Free projects can pause on inactivity, and quota exhaustion can interrupt work. The daily cap reduces usage; it does not guarantee the entire account always fits every free quota.

## Validation

- `npm test`: private-header guards, closed configuration, heartbeat/lease metadata, idle behavior, request-payload isolation, bounded failure path, explicit non-retryable HTTP 406 blocking, no fabricated empty successes, commit errors, and lifecycle source/error classification, plus existing provider/security tests.
- `tests/cloud-worker-security.sql`: transaction-only regression for ACLs, cap, global lease, stale/null tokens, bounds, partial-write rollback, dedup/provenance, tenant ownership, conservative confidence, replay, preservation of human assessments, cancellation and idle dispatch. **ROLLBACK** removes all fixtures and restores the original queue.
- `tests/cloud-provider-errors.sql`: transaction-only lifecycle regression for heartbeat/source/version visibility, no secret/job-ID status leakage, HTTP 406 `blocked` safety pause, and 429 `rate_limited` bounded retry. **ROLLBACK** restores the original worker and queue state.
- `tests/osm-snapshot.sql`: transaction-only regression for snapshot city scoping, limit clamping, unknown-city behaviour, and service-role-only loading. **ROLLBACK** leaves any loaded snapshot untouched.
- `npm run build && npm run typecheck`; Playwright checks the application and cloud-mode notices with explicit fixtures. Local mocks are not proof of a real Overpass response; production job logs are reported separately.

Official limits reviewed during implementation: [Edge runtime](https://supabase.com/docs/guides/functions/limits), [pricing and quotas](https://supabase.com/pricing). Free Edge wall-clock limit is currently 150 seconds and CPU time 2 seconds/request; recheck before changing batch sizes or adding CPU-heavy work. No guarantee of indefinite free operation is made.

## Deployment validation report — 2026-10-27

- Deployed `prospectai-worker` version 6 with the tracked self-contained native-Web-API artifact (no runtime imports). The unauthenticated readiness probe returned HTTP 401 `{ "error": "Unauthorized" }`, proving the deployed worker booted and rejected a caller before any database/provider access.
- The source request uses a standard HTTPS form `POST`, explicitly asks for JSON, and identifies the product with `ProspectAIStudio/1.2 (+https://prospectaistudio.vercel.app/responsible-use)` plus the same public responsible-use URL as Referer. This is policy-transparent request metadata, not a way to evade an endpoint's controls.
- With the worker paused first, exactly one existing bounded Karachi café job (maximum 25 results) was enabled and dispatched through the real scheduler/worker path. The provider again returned **HTTP 406**. The worker recorded the rejection as a failed job and automatically disabled scheduling; no business/source results were saved and no empty success was fabricated.
- **Final cloud state: PAUSED.** The failed job has the accurate provider-rejection message; the separate one-result queued job remains queued and blocked. No paid plan/add-on/new provider was activated, and no endpoint rotation, repeated retry, authentication workaround, or access-control/rate-limit bypass was attempted.
- The installed cron definition remains in place, but the disabled control row makes future ticks no-ops. Do not re-enable the worker until an operator obtains and configures a provider endpoint that explicitly permits this workload, then validates a single bounded job through this worker path.
- Successful real-source discovery is **not yet demonstrated**. The code and free-tier-oriented scheduling are implemented, but the source rejection is an external blocker, not a completed business-research workflow.
