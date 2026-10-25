# Bounded cloud discovery (Supabase free-tier-oriented)

The Next.js website remains on Vercel. A separate **Supabase Edge Function** processes real queued discovery jobs; Vercel does not run `npm run worker` automatically. No new project, paid subscription, compute upgrade, or paid add-on is required by this implementation. Existing account billing and usage still apply.

## What runs

- Supabase `pg_cron` checks due work every **5 minutes**. `pg_net` invokes the private Edge Function only when a discovery job is due. Empty queues do not consume Edge invocations.
- One discovery job per invocation, at most 100 results, 3 MB source response, 45-second Overpass request, and 80-second overall request deadline. The SQL RPC commits all results in one transaction. An incomplete response is an error, not a successful empty search.
- Project-wide lease and cooldown: at most one source query at a time, at least five minutes between attempts, **20 attempts per UTC day** maximum. Retries consume the same budget. Three attempts per job; provider errors are visible in job logs. Expired leases recover at the next eligible tick. Jobs beyond the daily cap remain queued until the next UTC day.
- Tenant owner comes from the claimed database job, never a request payload. Atomic job locking rechecks pause/cancel/delete before result writes. The claim token is consumed on commit; a replay cannot duplicate writes. Source IDs/fingerprints and conservative same-name/contact/domain checks reconcile duplicates, with provenance preserved.
- **Listing-only review.** The cloud worker never fetches arbitrary business URLs. This avoids weakening the Node worker's DNS-pinned SSRF protections in an Edge runtime. Evidence states exactly what was observed and what was NOT checked. Newly reviewed listings get independent 20/100 review aids and **Manual review required**, never verified-active/no-website claims. Existing human assessments are preserved. Up to five explicitly queued evidence reviews are resolved with the same source-only scope per cron tick.
- Retention cleanup runs once per UTC day when enabled, using the existing tenant retention preferences.
- No automatic AI generation or messaging. Outreach remains draft-only.

The long-running Node worker remains available for DNS-pinned website HEAD checks on a suitable server. **Use either cloud mode or the Node worker, not both concurrently.** They share queue leases, but the Node process is not governed by the cloud daily budget.

## Deployment and credentials

1. Apply `202610250001_cloud_worker.sql`. It installs existing-project extensions, service-only RPCs, an RLS-protected control table, and a disabled-by-default cron dispatcher.
2. Generate a cryptographically random 32-byte scheduler token. Store it in Supabase Vault as `pa_cloud_worker_token` and in Edge Function secrets as `PA_WORKER_TOKEN`. Do not put it in source, cron command text, `.env.example`, the browser, or Vercel public env.
3. Set Edge Function secret `PA_OVERPASS_URL` to an explicitly permitted HTTPS endpoint after reviewing its policy. Current setup uses `https://overpass-api.de/api/interpreter`. Public Overpass has resource/load limits, **not** a contractual free quota. Do not add endpoint rotation to evade rate limits.
4. `npm ci && npm run build:worker`. The tracked `supabase/functions/prospectai-worker/bundle.js` is a deliberately published, reproducible **secret-free** deployment artifact. It includes the shared source adapter/validation code and pins npm imports to versions from `package-lock.json`.
5. Deploy `prospectai-worker` using that bundle. The connector's single-file loader must reference the bundle at an **immutable Git commit**, not a mutable branch. Verify the deployed loader's commit on every release. For CLI deployment, deploy the bundle directly as the entrypoint with JWT verification disabled.
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
