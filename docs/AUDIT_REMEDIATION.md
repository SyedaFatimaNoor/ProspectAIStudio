# Audit remediation register

This is the implementation and operations record for the 4 November 2026
technical audit. It intentionally separates code that is present from work that
requires a domain owner, an approved provider, a real account, or an actual
source result. A status of **blocked** is not a completed finding.

## Production facts verified on 4 November 2026

- Connected Supabase project: `prospectai-studio` (`vfplvwtububtaovyalgu`),
  healthy.
- `pa_osm_snapshot_status()` is installed and reports **0 places / 0
  businesses**. The snapshot path is therefore installed, private, and
  inactive—not a source of leads.
- `pa_cloud_worker_status()` reports `enabled: false`, `0/20` attempts today,
  and the recorded permanent failure: a public OpenStreetMap provider returned
  HTTP 406. The scheduler remains paused. No endpoint rotation, retry bypass,
  paid upgrade, or fabricated result was used.
- `worker_operator_observability` was applied to the connected project. It
  exposes bounded last-outcome, quota, and activity metadata to authenticated
  status reads; it did not enable the worker or change a job.

## Finding register

| ID | Disposition | Evidence / exact remaining condition |
| --- | --- | --- |
| AUD-01 | **Blocked safely; alternate source installed** | The cloud worker is intentionally paused after the real 406. The snapshot database path, loader, and authenticated status are installed, but it is empty. Follow the snapshot runbook below before any enable action. |
| AUD-02 | **Blocked by AUD-01** | No real discovery row exists, so an honest discover → verify → studio → outreach run cannot yet be made. Do not seed a pretend lead to make this green. |
| AUD-03 | **Implemented; delivery needs operator verification** | Forgot-password link, request page, callback continuation, password update, and E2E coverage are in the app. A real branded recovery-email delivery test waits for AUD-06. |
| AUD-04 | **Implemented** | The empty outreach action now explains that a lead is required rather than behaving as a dead primary control. |
| AUD-05 | **Implemented** | CSP/frame protections and related security headers were added and tested in the prior remediation. Recheck real deployment headers after each platform configuration change. |
| AUD-06 | **External operator action required** | A sender domain, authorised SMTP provider, and DNS ownership are required for SPF/DKIM/DMARC alignment. The app cannot create those records or assume permission to send as a domain. |
| AUD-07 | **Implemented; production check pending** | Settings has a signed-in, server-only **Test AI connection** action. It sends no business data, returns only an actual bounded reply plus model and latency, audits metadata only, and is limited to 3 tests/5 minutes per runtime. Unit coverage proves the request shape. Do not call it with an unreviewed key or describe it as production-verified until an operator presses it and receives a real reply. |
| AUD-08 | **Baseline implemented; distributed enforcement still external** | `/api/workspace` and actions have short-lived per-runtime limits; expensive AI checks have a tighter authenticated limit. This is not a shared multi-instance/region limiter. Configure an approved edge/Redis limiter and load-test staging for a global guarantee. |
| AUD-09 | **Implemented** | Authenticated workspace/action responses use private, no-store controls. |
| AUD-10 | **Implemented** | Profile saves surface the same controlled notification path as other settings actions. |
| AUD-11 | **Implemented** | Callback failure/expiry is mapped to an explicit, recovery-oriented sign-in message. |
| AUD-12 | **Implemented** | API validation returns controlled human-readable errors instead of raw Zod shape details. |
| AUD-13 | **Implemented** | The shared client/server display-name rule accepts ordinary international text and punctuation (including `&` and quotes) and rejects only empty, overlong, or control-character input with feedback. |
| AUD-14 | **Truthfully deferred** | The sitemap deliberately omits invented `lastmod` values. No reliable build/deploy timestamp is currently supplied to the app. Add a trusted deployment timestamp at build time, then test the generated XML; do not use request time as a false content-update date. |
| AUD-15 | **Implemented** | Country now begins blank and the existing labelled validation asks for a country. |
| AUD-16 | **Implemented** | The paused-worker explanation has one visible canonical notice; the submit control retains a screen-reader-only explanation instead of duplicating visible copy. |
| AUD-17 | **Implemented** | The footer now says **Settings & integrations** for `/settings`. |
| AUD-18 | **Optional external enhancement** | Email/password remains the supported product choice. Activating Google/SSO needs the operator's OAuth client, consent screen, redirect-domain ownership, and Supabase configuration; no provider was enabled by this work. |
| AUD-19 | **Partially implemented; provider control remains required** | Credential, reset-email, and password-update forms now have a bounded browser-local retry brake without storing email/password/token data. It can be cleared or bypassed, so Supabase/edge controls remain the real protection. Review Supabase auth rate limits and enable CAPTCHA only after an authorised provider is configured. |
| AUD-20 | **Verified at schema level; real-row retest blocked** | Existing transactional RLS checks cover tenant reads/writes and relations. A two-account UI/API test with a real discovery row is explicitly waiting on AUD-01; it must be run after the bounded source validation. |
| AUD-21 | **Implemented** | Discovery already shows daily quota while scheduled; Settings now also shows used/remaining UTC quota, activity time, and the bounded last worker outcome for the operator. |
| AUD-22 | **No change needed** | Signed-out preview remains read-only and has no seeded/other-tenant records. |
| AUD-23 | **Removed / regression watched** | Current source has no `/api/broadcast` reference or route. CI build/type/browser coverage will catch normal client regressions; retain a source grep in release review if bundles are changed. |
| AUD-24 | **Fixture-tested; real-data retest blocked** | Evidence filters/tabs are covered with intercepted test-only workspace records. A real-row usability check follows AUD-01; no empty-state result is mislabelled as verification. |

## Recommendation register

| Recommendation | Follow-through |
| --- | --- |
| R-1 discovery worker | Snapshot alternative, bounded cloud worker, explicit pause behavior, and operator status are implemented. Actual restoration is blocked until the runbook below and one bounded real validation succeed. A third-party uptime monitor is not configured because it requires the operator's monitoring account/alert destination. |
| R-2 password recovery | Implemented in the app; validate delivery only after branded SMTP is authorised. |
| R-3 headers/cache | Implemented and covered in prior remediation. |
| R-4 branded email | Blocked on sender-domain/SMTP/DNS authority; see AUD-06. |
| R-5 feedback/dead controls | Implemented in prior remediation and extended with explicit display-name validation. |
| R-6 rate limiting | Per-runtime baseline and browser retry brake implemented. A distributed edge limiter is still an external infrastructure decision. |
| R-7 two-account end-to-end data test | Database/RLS transaction checks exist. Real workflow test is deliberately deferred until R-1 can produce one permitted real row. |
| R-8 AI health/fallback | Server-only health action, UI, bounded request/reply test, and compatible-provider fallback documentation are implemented. It is not a claim that a production key has been exercised. |
| R-9 CI | GitHub Actions now runs install, unit, type, production build, Playwright, and high-severity audit on pull requests and `main`. It cannot perform live signup/email/source tests without a separately authorised staging project. |
| R-10 website-status checking | Existing verification keeps timeouts/blocks ambiguous and avoids absence claims. Any broader contact-page fetch must remain SSRF-safe, policy-compliant, bounded, and be validated after R-1. |
| R-11 third-party enrichment | Not configured. It needs a provider account, lawful basis, approved monthly cap, and source attribution; it must not be substituted with guessed contacts. |
| R-12 worker dashboard | Settings now exposes scheduler state, quota, last activity/outcome, and snapshot readiness. A dedicated external status/alert service remains optional operator infrastructure. |
| R-13 onboarding | The existing workspace onboarding checklist explains account, source/worker, bounded search, and evidence steps without adding fictional sample records. |

## Snapshot activation runbook (operator only)

Do **all** of the following before considering discovery restored:

1. Obtain a country `.osm.pbf` from a source whose license, attribution, and
   terms you have reviewed (the documented path uses Geofabrik/OpenStreetMap).
   Keep the extract in ignored `.osm-cache/`; do not commit it.
2. Verify its published checksum, then run the documented local build/load
   command with a service-role credential held only by the operator:

   ```bash
   npm run osm:snapshot -- --file=.osm-cache/<country>.osm.pbf --country='<country>' --load
   ```

3. Check `select public.pa_osm_snapshot_status();`. It must show non-zero
   places and businesses and a known snapshot date. Confirm matching ODbL
   attribution remains in result facts.
4. Set **only in server/Edge secret settings**: `OSM_SNAPSHOT=1` for the app
   worker and `PA_OSM_SNAPSHOT=1` for the Edge Function. Do not expose a
   service-role key, snapshot file, or any secret to the browser. Deploy the
   matching worker artifact.
5. With the scheduler still paused, perform an authenticated readiness check.
   Then queue exactly one real, bounded search (for example, one city/category
   with a maximum of 10). Inspect logs, attribution, deduplication, job state,
   and counts. Do not create synthetic businesses.
6. Use two actual test accounts to verify account B cannot read account A's
   new lead through UI or API. Record the result and clean up test data under
   the retention/deletion policy.
7. Only after those checks pass may the authorised operator choose to enable
   scheduling. Monitor the Settings status and an independently configured
   alert destination. If a source rejects a request, pause again; never rotate
   endpoints, evade controls, or claim a successful discovery from a failed
   request.

## External configuration checklist

- **SMTP/domain (AUD-06):** pick an authorised sender provider; verify domain
  ownership; publish provider-issued SPF/DKIM records and an appropriate DMARC
  policy; configure Supabase SMTP sender name/address; test confirmation and
  reset delivery from the product domain; rotate any old SMTP credential that
  was exposed outside the intended secret manager.
- **Auth abuse controls (AUD-19):** set conservative Supabase email/OTP limits
  for expected traffic, review sign-up policy, and if using CAPTCHA first obtain
  and configure an approved CAPTCHA provider key. Browser-local limits are
  intentionally not represented as a bot-defense guarantee.
- **OAuth (AUD-18):** enable only an owned OAuth client with reviewed redirect
  URIs and privacy/consent requirements. It is optional and is not needed for
  password recovery.
- **Sitemap freshness (AUD-14):** provide a trusted build/deployment timestamp
  to the build process and add `lastModified` only from that immutable value.

