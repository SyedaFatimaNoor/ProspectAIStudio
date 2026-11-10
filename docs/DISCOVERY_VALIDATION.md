# Discovery diagnosis and safe restoration — 6 November 2026

This is an inspection and validation record. It does **not** claim that hosted discovery
is enabled, that a real discovery job has completed, or that production leads exist.
The scheduler remains disabled. No secret values, service-role credentials, cookies,
access tokens, or private user rows were printed or copied into this repository.

## 1. OpenStreetMap / Overpass adapter

- `src/lib/discovery-core.ts` — portable `discoverOpenStreetMap`, `overpassQuery`,
  `overpassRequestHeaders`, `parseProviderPayload`, and `discoverOsmSnapshot`.
- `src/lib/discovery.ts` — provider selection: `SnapshotProvider`,
  `StaticExtractProvider`, `OpenStreetMapProvider`; `snapshotEnabled()` and
  `discoverySourceConfigured()`.
- `src/lib/provider-health.ts` — explicit operator-triggered zero-area provider probe.
- `src/lib/static-extract.ts` — local `.osm.pbf` extract parsing.

## 2. Worker and scheduled-job implementation

- `supabase/functions/prospectai-worker/index.ts` — Edge worker handler.
- `supabase/functions/prospectai-worker/bundle.js` — reproducible, self-contained
  deployment artifact.
- `scripts/worker.ts` — separately started Node worker.
- `src/lib/worker-lifecycle.ts` — `cloudWorkerVersion = 7.0.3`, failure
  classification, bounded detail, source marker.
- `src/lib/cloud-worker.ts` — paused-worker display contract.
- `supabase/config.toml` — `[functions.prospectai-worker]` and `verify_jwt = false`.
- `supabase/migrations/202610250001_cloud_worker.sql` — `cron.schedule(
  'prospectai-cloud-worker','*/5 * * * *','select public.pa_cloud_tick()')`.
- `supabase/migrations/202611050004_worker_lifecycle_and_health.sql` — current cloud
  lifecycle, lease, heartbeat, daily cap, blocked/paused handling.
- `supabase/migrations/202611100001_discovery_stage_telemetry.sql` — bounded
  per-RPC timeouts and protected stage telemetry for the 7.0.3 worker.

## 3. OSM snapshot / import implementation

- `scripts/build-osm-snapshot.ts` — local build/load command.
- `src/lib/osm-snapshot.ts` — parses places and category listings from `.osm.pbf`.
- `src/lib/osm-snapshot-import.ts` — validates provenance, typed OSM identities,
  chunked service-only import, begin/complete/fail state.
- `src/lib/source-readiness.ts` — aggregate readiness guard.
- `src/lib/discovery-core.ts` — `discoverOsmSnapshot()` calls `pa_osm_search`.
- `supabase/migrations/202610300001_osm_snapshot.sql` — `pa_osm_places`,
  `pa_osm_businesses`, `pa_osm_search`, load RPCs, aggregate status.
- `supabase/migrations/202611050002_cloud_source_readiness.sql` — cloud preflight.
- `supabase/migrations/202611050003_osm_snapshot_import_metadata.sql` —
  `pa_osm_snapshot_import_state`, typed OSM identity, import provenance.

## 4. Supabase tables and migrations

Discovery jobs and tenant records:

- `pa_discovery_jobs` — `202610230001_prospectai.sql`; lifecycle columns in
  `202611050004_worker_lifecycle_and_health.sql`.
- `pa_businesses`, `pa_business_sources`, `pa_verification_runs`,
  `pa_website_candidates`, `pa_proposals`, `pa_outreach_messages`,
  `pa_outreach_events`, `pa_suppression_records`, `pa_integration_settings`,
  `pa_audit_logs` — `202610230001_prospectai.sql`, hardening in
  `202610230002_hardening.sql`, retention in `202610230003_retention.sql`.
- `pa_cloud_worker` — `202610250001_cloud_worker.sql`, extended by
  `202611040002_worker_operator_observability.sql`,
  `202611050001_provider_health_and_worker_success.sql`,
  `202611050004_worker_lifecycle_and_health.sql`.
- `pa_provider_health` — `202611050001_provider_health_and_worker_success.sql`.
- `pa_osm_places`, `pa_osm_businesses`, `pa_osm_snapshot_import_state` — snapshot
  migrations listed above.

Provider health checks use `pa_provider_health`, `pa_cloud_worker_status()`,
`pa_osm_snapshot_status()`, and the explicit `test_provider` action. Worker status
also uses `pa_cloud_heartbeat`, `pa_cloud_pause_source`, `pa_cloud_claim`,
`pa_cloud_commit`, and `pa_cloud_fail` in the lifecycle migration.

## 5. Relevant server routes / actions

- `src/app/api/actions/route.ts` — `create_job`, `resume_job`, `cancel_job`,
  `verify`, and `test_provider`. It derives tenant identity from `auth.getUser()`,
  checks snapshot readiness, blocks paused cloud work, and persists provider-health
  metadata.
- `src/app/api/workspace/route.ts` — tenant-scoped workspace read; reads
  `pa_cloud_worker_status()` and `pa_osm_snapshot_status()` aggregate metadata and
  loads tenant tables with `auth.uid()` RLS.
- No separate Next.js server-action files exist; only these two app API routes were
  found.

## 6. Environment variables used by discovery

Application / local worker:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `OVERPASS_URL`
- `OSM_EXTRACT_PATH`
- `OSM_EXTRACT_RADIUS_KM`
- `OSM_SNAPSHOT`

Edge worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PA_WORKER_TOKEN`
- `PA_OVERPASS_URL`
- `PA_OSM_SNAPSHOT`

No values are recorded here.

## 7. Exact configured endpoint, hostname and path only

The repository, Settings, README, and cloud-worker documentation identify the
configured public interpreter as:

`overpass-api.de/api/interpreter`

The live Vercel `OVERPASS_URL` and Edge `PA_OVERPASS_URL` are sensitive/redacted in
their secret managers; no secret value or URL with a query string is printed here.

## 8. Exact request method, headers, query body, timeout, and parser

Discovery request (`discoverOpenStreetMap`), aligned with the FOSSGIS usage
terms and official Overpass command-line/developer guidance:

- Endpoint: configured HTTPS interpreter; the documented FOSSGIS endpoint is
  `overpass-api.de/api/interpreter`. URLs with credentials, query strings, or
  fragments are rejected before a request.
- Method: HTTPS `POST` for bounded discovery queries, with the query in the
  request body.
- Headers:
  - `Content-Type: application/x-www-form-urlencoded`
  - `User-Agent: ProspectAI/1.0 (+https://prospectaistudio.vercel.app/responsible-use)`
  - `Referer: https://prospectaistudio.vercel.app/responsible-use`
  - No explicit `Accept`, `Authorization`, `Cookie`, `Accept-Encoding`, or other
    unnecessary headers. Overpass documentation says no other GET/POST headers
    affect behaviour; the runtime wildcard default avoids forcing a
    representation that a front door could reject with 406.
- Body: one correctly URL-encoded form field `data=<Overpass QL>` generated by
  `overpassQuery(input)`:
  `[out:json][timeout:25];(area["admin_level"="2"]["name"~"^<country>$",i];area["admin_level"="2"]["name:en"~"^<country>$",i];)->.country;(rel(area.country)["name"~"^<city>$",i]["boundary"="administrative"];rel(area.country)["name:en"~"^<city>$",i]["boundary"="administrative"];)->.city_rel;.city_rel map_to_area->.city;nwr(area.city)["<category key>"="<category value>"]["name"];out meta center <min(300, max_results*3)>;`
- Client timeout: `AbortSignal.timeout(30_000)` by default; Overpass QL internal
  timeout is 25 seconds, so the client does not abort before the query timeout.
- Response decompression: standard `fetch` decompression is used; no manual
  `Accept-Encoding` or second decompression. Decoded bytes are streamed with a
  3 MB cap.
- JSON parsing: `JSON.parse` on the bounded body, then `parseProviderPayload()`
  (max 1000 elements; validates ids, types, coordinates, tags). Empty bodies,
  malformed JSON, invalid shapes, oversized responses, and `remark` are errors,
  not successful empty searches. Valid zero-row JSON is an honest empty result.
- Status handling: non-2xx responses are read with the same bounded diagnostic
  and classified from status plus sanitised excerpt before an error is thrown.
  Safe categories: `provider_bad_request`, `provider_not_acceptable`,
  `provider_rate_limited`, `provider_timeout`, `provider_server_error`,
  `provider_invalid_response`, `provider_empty_response`,
  `provider_policy_blocked`. HTTP 406 is never automatically retried.
- Safe diagnostic: provider hostname, HTTP method, request ID, status code,
  response time, response Content-Type, decoded body length, sanitised excerpt
  (max 500 characters), and error category. It never logs API keys,
  Authorization headers, cookies, passwords, private contact data, or complete
  provider responses. Successful JSON is represented only by a marker.

Operator health probe (`checkProviderHealth("discovery")`):

- Very small, harmless zero-area query uses `GET` with a correctly encoded
  `data` query parameter and a result limit of one:
  `[out:json][timeout:5];node(0,0,0,0);out 1;`.
- No request body or `Content-Type`; same identifying User-Agent/Referer and no
  explicit `Accept`. Strict client timeout `AbortSignal.timeout(8_000)`. It
  emits the same safe diagnostic and parses JSON only after status/body checks.
- One persisted observation records provider configured state, hostname,
  request time, response time, HTTP status, response validity, last successful
  check, last failed check, last error, and recommended action. The server
  action persists a `checking` state first and is rate limited to one check per
  30 seconds. It never queues a job, creates a lead, modifies the OSM snapshot,
  or enables a worker.
- Operator-facing states: `not_configured`, `checking`, `reachable`, `blocked`,
  `rate_limited`, `timeout`, `invalid_response`, `unavailable`. HTTP 406 is
  `blocked / not acceptable`, keeps the worker paused, and is never retried
  automatically.

## 9. HTTP 406 diagnosis policy

The client does **not assume** that HTTP 406 is caused by the endpoint. It emits
a safe request diagnostic and classifies the response from its status,
Content-Type, and sanitised excerpt. A generic negotiation response is
`provider_not_acceptable`; a body indicating a block, ban, policy,
User-Agent/Referrer, hosting, or platform restriction is
`provider_policy_blocked`. Both are non-retryable. The current request uses the
official form POST style, a descriptive User-Agent, a valid Referer, and no
explicit `Accept` header, so a remaining 406 is evidence to review, not a reason
to rotate endpoints or retry indefinitely.

The public `overpass-api.de` operator uses 406 to identify manually blocked clients
and requires a descriptive User-Agent/Referer, one script at a time, and fair-use
pacing; a 406 that persists after a custom User-Agent means the application, domain,
or hosting network has been manually blocked and changing identity would not solve
the root cause [5](https://github.com/drolbr/Overpass-API/issues/791). Independent
reports show descriptive User-Agent headers changing 406 to 200 in ordinary clients
[3](https://github.com/hectmor/zmg-cafe-etl/pull/57) [10](https://github.com/UDST/osmnet/pull/33), while hosted Supabase Edge traffic has been observed receiving 406 on every
request, including `/api/status`, from `overpass-api.de`
[2](https://github.com/Rick007110/BeanDesk/pull/5). A later operator reply also
states commercial use should use self-installation or a commercial provider rather
than the shared public instance [5](https://github.com/drolbr/Overpass-API/issues/791).

Therefore the safe fix is **not** endpoint rotation, User-Agent spoofing, repeated
retry, or a provider restriction bypass. The existing app correctly classifies 406
as `provider_blocked`, pauses scheduling, and keeps discovery unavailable until an
operator-reviewed source is available. The validated path is the dated, attributed
OSM snapshot stored in the workspace database.

## 10. Files and database migrations intended to modify

Intended repository changes:

- `docs/DISCOVERY_VALIDATION.md` — this inspection/validation report.
- `docs/CLOUD_WORKER.md` — correct the 406 diagnosis and current source preference.
- `docs/PROVIDERS.md` — document the front-door 406 and snapshot precedence.
- `README.md` — update current cloud state.
- `src/app/(workspace)/settings/page.tsx` — show `OSM_SNAPSHOT=1` as the serverless
  source instead of presenting the blocked public endpoint as the primary example.

Intended database migrations: **none**. The existing snapshot, readiness, worker,
lifecycle, and provider-health migrations already provide the required schema and
guards. Snapshot rows were loaded through the existing service-only import RPCs;
no migration was applied or changed for this task.

## Safe validation performed

1. Inspected the adapter, worker, routes, migrations, env-var names, and exact
   request contract. No production user rows were read or modified.
2. Confirmed aggregate snapshot status was `empty`, `0` places, `0` businesses,
   and the cloud worker control row was `enabled=false`.
3. Obtained a small, real OSM XML extract from a public GitHub repository, with
   ODbL attribution in the file header. Source URL:
   `https://github.com/onaycan/3dCity_LOD1_rep/blob/4a0f03c9d4943335f4e1b1764b1d3a18889d8e33/OSM_DB/map_kadik%C3%B6y_caferaga_small.osm`.
   Local SHA-256 of the converted PBF:
   `a04f5103bcb261b992aa596302b480cda2163b43836634730ddbe2dc5b73a106`.
4. Converted it locally to a PBF and built a bounded snapshot: 1 place, 26 real
   OSM listings, 3 with public contact. No business was invented.
5. Loaded those rows through `pa_osm_snapshot_begin_import`, `pa_osm_load_places`,
   `pa_osm_load_businesses`, and `pa_osm_snapshot_complete_import`. Aggregate
   `pa_osm_snapshot_status()` now reports `import_status: ready`, 1 place, 26
   businesses, source URL, ODbL attribution, record date `2026-11-06`, and a
   successful import timestamp.
6. Validated `pa_osm_search('Turkey','Caferağa','cafe',10)` returns 10 real
   snapshot rows. This is a source readiness check, not a discovery job and not a
   Leads Explorer record.
7. Set application `OSM_SNAPSHOT=1` and Edge `PA_OSM_SNAPSHOT=1` so the validated
   snapshot path is preferred. No Overpass endpoint was rotated, no provider
   request was made, no retry was attempted, and no secret value was printed.
8. Left `pa_cloud_worker.enabled=false`. No discovery job was queued or resumed,
   no `pa_businesses` lead was inserted, and no successful production discovery
   completion is claimed.

## Remaining operator condition

A full-country extract is still needed before general production discovery. This
validated snapshot is a small, dated, source-backed extract covering Caferağa,
Turkey; it is not a blanket assertion that all cities/categories are covered.
Before enabling scheduling, an authorised operator should load a reviewed country
extract with its published checksum, run one bounded real job while scheduling
remains paused, inspect provenance and deduplication, and verify tenant isolation
with two actual test accounts. If a source rejects a request, pause again; never
rotate endpoints or claim success from a failed request.
