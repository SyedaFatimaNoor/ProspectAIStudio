# Implementation status

- [x] Inspect repository (empty), dependencies, and existing remote schema.
- [x] Preserve existing Supabase tables with isolated `pa_` namespace.
- [x] Responsive public site, design system, navigation, all requested product views, accessible dialogs and empty states.
- [x] Supabase email/password auth, callback, migrations, RLS, relational ownership, and persistent workflow API.
- [x] OpenStreetMap provider, deduplication, bounded background worker, retry/cancellation/leases/logs/retention.
- [x] Conservative website evidence checks, safe redirects/DNS pinning, independent activity/website fields, manual attestation/history.
- [x] Optional OpenAI-compatible model, free fact-based drafts, editable/revisable/exportable proposals.
- [x] Draft editing, saved-version approval gate, manual reply/follow-up events, suppression and database send guard.
- [x] Production build, strict typecheck, unit tests, Playwright workflow tests and automated accessibility checks.
- [x] Live transactional database isolation/security tests with all fixtures rolled back.
- [x] Optional capped Supabase cloud discovery worker, listing-only evidence scope, private scheduler authentication, atomic results and cloud-mode UI notices.
- [x] Setup, provider policies, security boundaries, deployment instructions, and honest limitations.

## Deliberately not claimed complete

- Network-enabled authenticated real-provider/AI integration E2E validation.
- Broad permitted domain-search/current-activity source integrations or automated high-confidence absence proof.
- Sending adapters, delivery/reply webhooks, automatic follow-ups.
- High-volume server-side explorer/aggregate analytics and transactional outbox.
- Team permissions, MFA/recovery UI, billing, and live deployment.

See README.md and docs/PROVIDERS.md. There are no fake production leads or invented verification evidence.
