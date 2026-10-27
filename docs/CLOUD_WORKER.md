# Bounded cloud discovery (Supabase free-tier-oriented)

The Next.js website remains on Vercel. A separate **Supabase Edge Function** processes real queued discovery jobs; Vercel does not run `npm run worker` automatically. No new project, paid subscription, compute upgrade, or paid add-on is required by this implementation. Existing account billing and usage still apply.

## What runs

- Supabase `pg_cron` checks due work every **5 minutes**. `pg_net` invokes the private Edge Function only when a discovery job is due. Empty queues do not consume Edge invocations.
- One discovery job per invocation, at most 100 results, 3 MB source response, 45-second Overpass request, and 80-second overall request deadline. The SQL RPC commits all results in one transaction. An incomplete response is an error, not a successful empty search.
- Project-wide lease and cooldown: at most one source query at a time, at least five minutes between attempts, **20 attempts per UTC day** maximum. Retries consume the same budget. Three attempts per job with five-/ten-minute retry backoff; provider errors are visible in job logs. Permanent HTTP 400/401/403/404/405/406/410/422 rejections fail the job and pause scheduling for operator review, without mirror rotation or bypass. Expired leases recover at the next eligible tick. Jobs beyond the daily cap remain queued until the next UTC day.
- Tenant owner comes from the claimed database job, never a request payload. Atomic job locking rechecks pause/cancel/delete before result writes. The claim token is consumed on commit; a replay cannot duplicate writes. Source IDs/fingerprints and conservative same-name/contact/domain checks reconcile duplicates, with provenance preserved.
- **Listing-only review.** The cloud worker never fetches arbitrary business URLs. This avoids weakening the Node worker's DNS-pinned SSRF protections in an Edge runtime. Evidence states exactly what was observed and what was NOT checked. Newly reviewed listings get independent 20/100 review aids and **Manual review required**, never verified-active/no-website claims. Existing human assessments are preserved. Up to five explicitly queued evidence reviews are resolved with the same source-only scope per cron tick.
- Retention cleanup runs once per UTC day when enabled, using the existing tenant retention preferences.
- No automatic AI generation or messaging. Outreach remains draft-only.

The long-running Node worker remains available for DNS-pinned website HEAD checks on a suitable server. **Use either cloud mode or the Node worker, not both concurrently.** They share queue leases, but the Node process is not governed by the cloud daily budget.

## Deployment and credentials

1. Apply `202610250001_cloud_worker.sql` and `202610250002_cloud_provider_rejections.sql`. It installs existing-project extensions, service-only RPCs, an RLS-protected control table, and a disabled-by-default cron dispatcher.
2. Generate a cryptographically random 32-byte scheduler token. Store it in Supabase Vault as `pa_cloud_worker_token` and in Edge Function secrets as `PA_WORKER_TOKEN`. Do not put it in source, cron command text, `.env.example`, the browser, or Vercel public env.
3. Set Edge Function secret `PA_OVERPASS_URL` to an explicitly permitted HTTPS endpoint after reviewing its policy. Current setup uses `https://overpass-api.de/api/interpreter`. Public Overpass has resource/load limits, **not** a contractual free quota. Do not add endpoint rotation to evade rate limits.
4. `npm ci && npm run build:worker`. The tracked `supabase/functions/prospectai-worker/bundle.js` is a deliberately published, reproducible **secret-free** deployment artifact. It includes the shared portable source adapter and strict bounded-response/job validators. It uses only native Web APIs and has **no runtime npm, Node, or GitHub imports**. The build fails if any external import remains.
5. Deploy `prospectai-worker` with the **contents** of that bundle as its entrypoint, with JWT verification disabled. Do not use a remote-import loader: the connector deployment does not bundle those dependencies, and a runtime remote import can fail with `BOOT_ERROR`. The deployed source must match the tracked artifact; check both hashes before enabling the scheduler. A function marked ACTIVE is not proof it boots—make an authenticated readiness call while the scheduler is disabled and expect `{ "idle": true }`.
6. `verify_jwt=false` is intentional: the function instead requires a constant-time checked, private `x-worker-token`. No unauthenticated request can reach the database/provider. Do not remove that check. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into the Edge runtime; neither goes into browser code or cron headers. Rotate any credentials previously exposed in chat before continuing production use.
7. After transactional tests and a deployment readiness check, enable the singleton control row. Existing queued jobs are preserved; no new accounts or synthetic production leads are created.

The migration's scheduler URL targets the application's existing Supabase project. Change it deliberately if deploying to another project.

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

- `npm test`: private-header guards, closed configuration, idle behavior, request-payload isolation, bounded failure path, no fabricated empty successes, commit errors, plus existing provider/security tests.
- `tests/cloud-worker-security.sql`: transaction-only regression for ACLs, cap, global lease, stale/null tokens, bounds, partial-write rollback, dedup/provenance, tenant ownership, conservative confidence, replay, preservation of human assessments, cancellation and idle dispatch. **ROLLBACK** removes all fixtures and restores the original queue.
- `npm run build && npm run typecheck`; Playwright checks the application and cloud-mode notices with explicit fixtures. Local mocks are not proof of a real Overpass response; production job logs are reported separately.

Official limits reviewed during implementation: [Edge runtime](https://supabase.com/docs/guides/functions/limits), [pricing and quotas](https://supabase.com/pricing). Free Edge wall-clock limit is currently 150 seconds and CPU time 2 seconds/request; recheck before changing batch sizes or adding CPU-heavy work. No guarantee of indefinite free operation is made.

## Deployment validation report — 2026-10-27

- Deployed `prospectai-worker` version 6 with the tracked self-contained native-Web-API artifact (no runtime imports). The unauthenticated readiness probe returned HTTP 401 `{ "error": "Unauthorized" }`, proving the deployed worker booted and rejected a caller before any database/provider access.
- The source request now explicitly asks for JSON and identifies the product with `ProspectAIStudio/1.1 (+https://prospectaistudio.vercel.app/responsible-use)`. This is policy-transparent request metadata, not a way to evade an endpoint's controls.
- With the worker paused first, exactly one existing bounded Karachi café job (maximum 25 results) was enabled and dispatched through the real scheduler/worker path. The provider again returned **HTTP 406**. The worker recorded the rejection as a failed job and automatically disabled scheduling; no business/source results were saved and no empty success was fabricated.
- **Final cloud state: PAUSED.** The failed job has the accurate provider-rejection message; the separate one-result queued job remains queued and blocked. No paid plan/add-on/new provider was activated, and no endpoint rotation, repeated retry, authentication workaround, or access-control/rate-limit bypass was attempted.
- The installed cron definition remains in place, but the disabled control row makes future ticks no-ops. Do not re-enable the worker until an operator obtains and configures a provider endpoint that explicitly permits this workload, then validates a single bounded job through this worker path.
- Successful real-source discovery is **not yet demonstrated**. The code and free-tier-oriented scheduling are implemented, but the source rejection is an external blocker, not a completed business-research workflow.
