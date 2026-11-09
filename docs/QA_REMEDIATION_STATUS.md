# QA remediation status — 2026-11-07 audit

This document records the repository-safe remediation for the 2026-11-07 QA
audit. It intentionally does **not** claim that production configuration or a
market-scale source import has been completed.

## Included in this repository change

- BUG-004: reset the lead-detail manual assessment form when switching leads.
- BUG-005: detect a stale enabled worker heartbeat or an abandoned queued job.
- BUG-006: use an optional service-role DB limiter when configured, with the
  bounded in-memory limiter as a fallback.
- BUG-007: replace dead website-status filter values with actual stored states.
- BUG-008: preserve the previous proposal copy in a tenant-scoped revision
  table before incrementing its version.
- BUG-009: restore conservative partial unique dedupe indexes for ordinary
  non-duplicate review rows.
- BUG-010, BUG-019, BUG-020: gate the preview banner on loading, include the
  year in dates, and make the overview chart respect its selected period.
- BUG-011, BUG-012: add canonical country aliases and make the snapshot search
  a readiness-gated, service-role-only RPC.
- BUG-014: add a server-side `?page=` path for older lead windows and disclose
  the loaded page, size, and boundary in the workspace notice.
- BUG-015, BUG-016: align suppression copy with exact-recipient matching and
  block exports when unsaved edits would differ from the audited saved draft.
- BUG-018, BUG-021, BUG-026: route a signed-in topbar avatar to settings, add
  ARIA tab semantics, label quick search, focus-trap the mobile drawer, make
  error notifications assertive, and show busy feedback on outreach saves.
- BUG-022, BUG-023: fail closed on partial public Supabase configuration and
  require an explicit opt-in for source defaults; move the scheduler function
  URL and secret name into service-only operator config.
- BUG-024, BUG-003: surface a bounded provider-health schema warning instead
  of silently presenting an empty history.
- BUG-025: require confirmation before the destructive expired-lead purge.
- BUG-028: label a tiny imported extract as validation-scale, not market-wide
  coverage. A market-scale import remains an operator data task.

## SQL migration

`supabase/migrations/202611070001_qa_remediation.sql` is additive and contains
no credentials, user rows, leads, or business facts. It **has not been applied
to production** from this coding sandbox.

Before enabling the cloud scheduler, an operator must insert a reviewed HTTPS
function URL and Vault secret name into `pa_cloud_worker_config`. The new
`pa_cloud_tick()` intentionally fails closed if that config or secret is
missing. The worker remains disabled.

## Operator-side tasks still required

1. BUG-001: set the Supabase Auth Site URL to the production origin, add the
   `/auth/callback` redirect allowlist, and remove Deployment Protection from
   the callback host.
2. BUG-002: create the Vault worker token, verify the cron schedule, deploy the
   Edge Function, and run one bounded real discovery job. Do not enable the
   worker until the readiness and health checks pass.
3. BUG-003: apply migration `202611060001_provider_health_diagnostics.sql` to
   production, then apply the new QA remediation migration after review.
4. BUG-028: import a lawful, attributed, market-scale OSM extract using the
   existing snapshot tooling. Never fabricate listings, contacts, websites, or
   emails to fill coverage gaps.
5. Re-run the 18 blocked QA cases only after a bounded real discovery job
   succeeds and no messages have been sent.

No live provider request, production configuration change, production data
change, worker enablement, or email/WhatsApp delivery was performed for this
repository batch.
