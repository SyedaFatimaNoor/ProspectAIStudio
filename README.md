# ProspectAI

A premium, evidence-first business research workspace built with Next.js App Router, strict TypeScript, Tailwind CSS, Radix/shadcn-style accessible primitives, Lucide, Zod, and Supabase.

**No fake leads or metrics are seeded.** The public homepage's fictional examples are labelled. Unauthenticated workspace pages are read-only previews; data and mutations require Supabase authentication. Discovery reports actual provider responses, not generated businesses.

## Quick start

Requires **Node.js 22+** and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The server binds to `0.0.0.0` for hosted previews. The app defaults to the existing `prospectai-studio` Supabase project. You can explore all pages without signing in; persistent actions require authentication. To use another project, override both public connection variables together.

### Supabase

Use Supabase locally (free/open-source) or a hosted project:

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
2. Apply the SQL files in `supabase/migrations/` **in filename order** using the SQL editor, `psql`, or the Supabase CLI against a new application schema.
3. Enable email/password authentication. Configure Site URL to your app's actual origin and add `https://your-origin/auth/callback` to allowed redirect URLs. For local development, allow `http://localhost:3000/auth/callback`. Never allow arbitrary production redirect origins.
4. Create an account at `/sign-in`. If email confirmation is enabled, confirm the email before signing in. Supabase's own email limits apply; production SMTP is optional configuration outside this app.

**Existing connected project:** the three original migrations and the cloud-worker migration were applied to `prospectai-studio` during this build. Existing application tables were preserved. Do **not** reapply these non-idempotent migrations to that project. The project URL and browser-safe publishable key are configured in `src/lib/supabase-config.ts`, with optional `.env.local` overrides. Keeping public defaults in source preserves the connection across preview restarts. No service-role or secret key is stored in source. The current preview callback URL is registered with Supabase; register the exact callback origin again if a future sandbox has a new hostname.

### Why `pa_` tables?

The connected project already had unrelated tables. ProspectAI uses isolated `pa_` names rather than overwriting them:

`pa_profiles`, `pa_discovery_jobs`, `pa_businesses`, `pa_business_sources`, `pa_verification_runs`, `pa_website_candidates`, `pa_proposals`, `pa_outreach_messages`, `pa_outreach_events`, `pa_suppression_records`, `pa_integration_settings`, `pa_audit_logs`.

Every table has RLS. Ownership is checked against `auth.uid()`, with composite `(record_id, user_id)` foreign keys preventing cross-tenant associations. Audit access is read/append only. Business deletion cascades to related research/proposals/drafts; suppression records remain to honour opt-outs. No private storage bucket or service-role credential is exposed to clients.

## Live discovery and background processing

### Laptop-free cloud option

The existing project supports a private **Supabase Edge Function + Cron** worker, without a new paid service. It checks due jobs every five minutes, limits discovery to 20 attempts per UTC day, commits results atomically, and skips idle Edge invocations. Cloud evidence review is explicitly **listing-only**, not live website checks. Vercel still hosts the website; deploying Next.js alone does not start background processing.

See [cloud setup, private token handling, quotas, health and pause controls](docs/CLOUD_WORKER.md). Free quotas still apply; no indefinite-free guarantee is made. Do not run the persistent Node worker at the same time as cloud mode.

### Persistent Node worker (alternative)

```dotenv
# Configure only after reviewing the endpoint's usage policy.
OVERPASS_URL=https://overpass-api.de/api/interpreter
# Worker only; obtain from your own Supabase project dashboard.
SUPABASE_SERVICE_ROLE_KEY=...
```

```bash
# In a separate terminal/process:
npm run worker
```

The worker is a persistent process, **not a serverless route**. It polls PostgreSQL jobs, claims leases, queries one permitted OpenStreetMap source, deduplicates records, stores provenance, and queues conservative website checks. It performs one discovery job and one verification at a time with bounded requests, at most three attempts, structured logs, restart leases, pause/cancel controls, and daily retention cleanup (default 90 days). The UI polls active work every five seconds while visible.

No source is enabled by default. Without `OVERPASS_URL`, creating a discovery returns an actionable error and no fake completion. Without a worker, jobs remain queued with a clear waiting log. Website-only verification can run without Overpass once a real lead exists.

**Network in this build environment:** local outbound access is restricted. Application-to-Supabase authenticated sessions and a real AI model could not be exercised end-to-end locally. Cloud source execution is checked separately through the deployed Edge Function and real job logs; see the deployment report in docs/CLOUD_WORKER.md. Database migrations and transactional RLS/security checks were executed through the connected Supabase tool. No real businesses were invented or imported to work around the restriction.

## Website concepts and outreach

1. Discover a real business.
2. Review its evidence at `/verification` or in lead details.
3. Record a supported manual activity assessment in **Record assessment**, with recent observation date, source URL(s), and explanation. Source presence alone does not qualify as active evidence.
4. In `/studio`, choose the verified business. Create the free, explicitly labelled fact-based template, or use an optional model.
5. Edit, save/revise, and export Markdown proposals.
6. In `/outreach`, choose a business, edit an email/WhatsApp draft, save changes, then preview and document lawful basis before individual approval.
7. Record replies, follow-up notes, and opt-outs. Suppression automatically blocks matching drafts. Editing resets approval; unsaved edits cannot be approved.

**Draft-only means draft-only:** this release has no sending adapters, no bulk dispatch, and no delivery webhooks. Approval does not send anything. The database rejects sending even if an API/UI guard is bypassed.

### Optional local AI (no paid API required)

```dotenv
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=your-installed-ollama-model
# Only if required by your provider:
AI_API_KEY=
```

Use `localhost` only for a model on the **server machine**. Browser code uses relative application API URLs and never calls a server on the user's localhost. A remote deployment needs a privately reachable model endpoint and appropriate authorisation. AI is server-only and receives a small whitelist of supported facts, not secrets or contact data.

See [provider documentation](docs/PROVIDERS.md) for data restrictions, verification scoring, failure handling, AI boundaries, and messaging requirements.

## Application routes

| Route           | Purpose                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/home`    | Public product information, labelled sample preview, privacy/responsible-use information, FAQs                            |
| `/sign-in`      | Email/password sign in and account creation                                                                               |
| `/overview`     | Database-derived metrics, chart, pipeline, jobs, sources, and honest empty states                                         |
| `/discovery`    | Bounded discovery form, source configuration, job controls, progress, logs/errors                                         |
| `/leads`        | Search, filters, sorting, pagination, column controls, selection, CSV export, detailed provenance/history/notes, deletion |
| `/verification` | Independent activity/website assessment and manual evidence workflow                                                      |
| `/studio`       | Optional AI or manual templates, editing, revisions, saved proposals and Markdown export                                  |
| `/outreach`     | Drafting, personalisation, preview, approval, manual events and suppression                                               |
| `/settings`     | Provider status/setup, preferences, retention cleanup, profile and sign out                                               |

## Testing and quality

```bash
npm run build
npm run typecheck
npm test
npm run test:e2e
npm audit --omit=dev
```

Playwright uses npm-distributed serverless Chromium because this environment blocks Playwright's usual browser CDN. The config extracts its bundled libraries, launches with normal web security, and uses one worker. On unsupported platforms, adapt `playwright.config.ts` to your locally installed Playwright browser. `PLAYWRIGHT_BASE_URL` can point tests at a running production build; otherwise Playwright starts the dev server. Do not run a build and dev server against the same `.next` directory simultaneously.

- Unit tests exercise provider validation, deduplication, query escaping, private-network blocking, redirect classification, timeout uncertainty, draft schemas, safe CSV, and optional AI degradation.
- Browser tests use the actual Next.js UI and real unauthenticated API guards. Authenticated workflows use **test-only intercepted HTTP responses**, not fabricated production records. They cover discovery queuing, lead filters/details/evidence, proposal saving/export, draft editing/approval gating, suppression, provider errors, and responsive/keyboard behaviour.
- Automated axe WCAG A/AA tests cover the public homepage and all main pages. Automated scans do not replace a full assistive-technology audit.
- Transactional live Supabase checks verified RLS read/write isolation, cross-tenant relation enforcement, send blocking, approval requirements, and opt-out propagation. Fixtures were rolled back. See `tests/database-security.sql` to repeat them.

## Deployment

1. Deploy the Next.js web app to a Node-capable host (`npm ci && npm run build`, then `npm start`) or a compatible Next.js platform.
2. Provide environment variables through the hosting platform's secret manager, not source control. Only the URL and **publishable** key have `NEXT_PUBLIC_` prefixes.
3. Apply migrations and configure auth redirects for the production hostname.
4. Run the worker on a separate persistent Node process/container with the server-only service-role key. Do not run the worker inside a serverless request. For a public shared Overpass endpoint, use one worker and honour provider policy.
5. Restrict outbound network access at infrastructure level. Candidate URL checking also validates and pins public DNS results. AI/Overpass endpoint URLs are administrator-controlled environment values; restrict who can edit deployment settings.
6. Restart web/worker processes after changing configuration. Monitor structured worker logs and failed leases. Configure backups, HTTPS, email confirmation, production authentication rate limits, and your jurisdiction-specific privacy/retention policy before production use.

### Current limitations / not claimed complete

- No permitted search-engine integration, review-activity API, or automatic high-confidence absence proof. OSM/HEAD results require human review. Parking detection is host-based only.
- Live provider/AI/authenticated browser-to-database happy paths need validation in a network-enabled deployment with real credentials and test accounts.
- No email/WhatsApp sending, delivery tracking, automatic follow-ups, or reply webhooks. Only draft management, approval, exports, and manual event records are implemented.
- Provider rate limits are per worker; use one worker for shared endpoints. Work is resumable by requery/reconciliation, not an exact source cursor checkpoint.
- The workspace currently loads up to 1,000 recent records per section, with a visible warning if rows are truncated and performs explorer filters/pagination in the client. High-volume production usage needs server-side filtered pagination, aggregate analytics, and transactional write/audit outbox operations.
- Profile/security is basic email/password plus sign-out; MFA, recovery UI, organisations/team permissions, billing, and file storage are not implemented.
- No live deployment was created. The local preview and production build are available in this workspace.

No part of the app guarantees worldwide coverage, current operation, accurate contacts, website absence, lawful outreach, or business outcomes. Human review and source/platform/legal compliance remain essential.
