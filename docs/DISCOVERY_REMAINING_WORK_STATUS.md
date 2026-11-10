# Discovery remaining work — repository-safe status

Last updated: 10 November 2026

This records the repository-safe work completed for the supplied Discovery
remaining-work checklist. It does **not** claim that live deployment, live RPC
testing, a live five-result job, or production readiness verification has been
completed from this coding workspace.

## Completed in the repository

1. **Bounded stage telemetry**
   - Added `WorkerStage` and `safeWorkerStage()` to `src/lib/worker-lifecycle.ts`.
   - The Edge worker now records a bounded stage for configuration, database,
     heartbeat, snapshot status, source pause, claim, job validation, snapshot
     search, Overpass search, transform, commit, completion, and failure logging.
   - Only the stage name and safe failure category are logged. Tokens,
     authorization headers, raw user data, and provider payloads are never stored.
   - `pa_cloud_fail` now accepts `p_stage` and stores it in
     `pa_discovery_jobs.worker_stage`, `pa_cloud_worker.last_failed_stage`,
     job logs, and `pa_cloud_worker_status()`. A six-argument compatibility
     overload remains for rolling deploys.
   - Settings now displays the last failed stage and includes the stage in the
     last-failed-job summary.

2. **Generated worker bundle**
   - Worker version is `7.0.3` in `src/lib/worker-lifecycle.ts`.
   - `npm run build:worker` regenerates
     `supabase/functions/prospectai-worker/bundle.js` from the committed source.
   - The generated bundle contains no credentials.

3. **RPC timeouts and failure-path independence**
   - `supabase/migrations/202611100001_worker_rpc_timeouts.sql` from `main` sets
     bounded statement timeouts for snapshot search, commit, and fail RPCs.
   - New migration `supabase/migrations/202611100001_discovery_stage_telemetry.sql`
     adds lock timeouts and per-function timeout settings for heartbeat, claim,
     snapshot status, snapshot search, commit, and fail RPCs.
   - The worker's failure RPC now uses an independent 10-second database deadline
     so an expired discovery deadline cannot prevent lease cleanup.

4. **Search/commit path safety**
   - Confirmed `discoverOsmSnapshot()` truncates transformed rows at
     `input.max_results` before `pa_cloud_commit` validates the bounded result.
   - Added stage boundaries around snapshot search, transform, and commit so the
     next live failure records `snapshot_search` or `commit` explicitly.
   - Added tests for the `overpass_search` and `commit` failure stages.
   - Updated cloud-worker security expectations for the new seven-argument
     failure RPC.

## Remaining operator-side work

The following require explicit production authorization and were not performed:

1. Apply `202611100001_discovery_stage_telemetry.sql` to the live Supabase
   project after review.
2. Deploy the generated `bundle.js` content to the existing
   `prospectai-worker` function while preserving `verify_jwt = false`,
   `x-worker-token`, snapshot mode, required secrets, and version `7.0.3`.
3. Run bounded, controlled tests for `pa_osm_snapshot_status`,
   `pa_osm_search('Turkey','Caferağa','cafe',100)`, a disposable leased commit,
   and `pa_cloud_fail`.
4. Use the new stage telemetry to identify and fix the exact live failing stage.
5. Run the clean five-result live end-to-end Discovery test.
6. Verify deliberate failure behavior separately.
7. Clear obsolete test noise while retaining audit history.
8. Run `npm run typecheck`, `npm test`, `npm run build:worker`, `npm run build`,
   and `npm run test:e2e` in the final deployment workflow, then verify GitHub,
   Vercel, and Supabase deployment hashes.

No live provider request, production migration, production configuration
change, worker deployment, user-data cleanup, or email/WhatsApp delivery was
performed for this repository batch.
