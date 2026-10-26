# Website review — P1 activation and discovery feedback

This follow-up covers review Phase 2: discovery validation and first-run onboarding. It builds on the P0 SEO/assets/policy work without rebuilding the product or changing authentication, schema, provider access, billing or worker scheduling.

## Implemented

- Discovery uses the same strict Zod job schema as the protected API. Required country/city reject whitespace-only input. Result counts must be whole numbers from 1 to 100 and within the account's saved search limit. The untouched default adjusts to that limit; user edits are not silently overwritten.
- Validation is shown after the first submit, then updates as fields are corrected. Field errors use `aria-invalid`, associated error text and a live error summary. Focus goes to the first invalid named control. Existing hint/custom description IDs survive the shared `Field` wrapper.
- Queueing has a visible disabled/loading button, persistent server-error feedback, preserved form input and explicit user-initiated retry. A successful queue response is not labelled a successful provider search; the message points to job logs for actual results and failures.
- Preview, loading/failed workspace connection, missing source/database and known paused-cloud-worker states stop avoidable form requests and explain the next step. A missing worker-status response is **unknown**, not proof that an external worker is down. Such users can still queue a job, with a visible warning that source configuration alone does not establish worker readiness. Daily-cap exhaustion delays cloud processing rather than falsely blocking job storage.
- One consistent first-run guide appears across the seven workspace routes for signed-out/empty workspaces. It is open on Overview and compact/collapsible elsewhere. Steps cover account → source/worker → bounded search → evidence review, with one relevant primary action, optional-AI explanation, draft-only boundary and explicit sample-data disclaimer. The guide creates no records or connections and is hidden for established workspaces with business records.
- Workspace connection errors are distinct from signed-out preview. Successful state is retained after a failed refresh; account captions become unconfirmed, the guide exposes an explicit retry, and stale discovery requests are blocked until recovery. The Overview preview banner is not displayed while connection status is unknown.

The new prerequisite checks are UX guards, not authorisation. Existing server-side authentication, strict request validation, result/active-job caps, tenant RLS and draft-only sending restrictions remain in place. No live database writes or provider calls are used by the new HTTP-fixture browser tests.

## Verification coverage

Final local production-build results (25 October 2026): **build/typecheck PASS, 40 unit tests PASS, 44 browser tests PASS, dependency audit 0 vulnerabilities**. This adds 6 unit and 10 browser regressions to the P0 baseline. Desktop/mobile guide layout and mobile validation focus were also visually inspected.

New unit coverage: international/trimmed locations, whitespace-only fields, strict counts including NaN/decimals/booleans, global/account caps, optional-field bounds, setup guards, paused versus unknown workers and daily-cap semantics.

New production-server browser coverage: inline errors and first-invalid focus; preserved hint/error associations; account-limit defaults; busy/double-submit prevention; queued-only messaging; preview/setup/paused request prevention; persistent errors and explicit retry; guide presence/navigation across seven routes; mobile overflow and automated WCAG A/AA scans; connection recovery and last-known-good account/form preservation after failed refresh. Existing P0 and workspace regression suites are retained unchanged.

## Remaining review phases / limitations

- Small-text typography, landing/LCP/font/CLS optimisation and deeper mobile-navigation polish are the next separate review batch. No new Lighthouse, field INP or production performance claim is made here. Sharing Zod validation increases the Discovery route's first-load JavaScript by approximately 28 kB in the production build; the landing bundle is unchanged. Route bundle optimisation remains part of that performance audit.
- Fixture-backed journeys do not prove real production signup, cross-session persistence or provider availability. Authenticated integration QA remains a separate launch requirement.
- The previous real provider HTTP 406 remains unresolved and the cloud worker remains paused. This change neither re-enables it nor rotates endpoints to avoid the rejection.
- Verified legal operator/privacy-contact details identified during P0 are still required; no legal identity, support address or compliance guarantee has been invented.
