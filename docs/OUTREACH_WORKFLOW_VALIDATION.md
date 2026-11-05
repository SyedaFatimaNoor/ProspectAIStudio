# Outreach Centre workflow validation

## Scope

This validation covers the Outreach Centre draft-only workflow with a real, public, source-backed **verified test lead**, using test-only intercepted HTTP responses. No production user rows were read, inserted, modified, or exported, and no email or WhatsApp message was sent.

### Source-backed test lead

The fixture in `tests/outreach-fixtures.ts` uses **Café nt**, from public OpenStreetMap node `788761098` and its official-site candidate at `https://www.ntcafe.de/`.

- OSM node JSON: `https://api.openstreetmap.org/api/0.6/node/788761098.json`
- OSM page: `https://www.openstreetmap.org/node/788761098`
- Official-site candidate: `https://www.ntcafe.de/`
- OSM observation: `2026-01-30T11:55:45Z`
- Public contact: OSM `contact:phone="+49 345 5110712"`, normalized in the fixture to `+493455110712`
- Channel: WhatsApp Business draft only, because no public email address was present in the OSM tags

The fixture preserves source URLs, provenance, observation timestamps, independent activity/website confidence, and evidence explanations. Listing presence is not treated as proof of continuous operation; website reachability is not treated as ownership proof. It does not fabricate an email address, a delivery, a publication, a consent record, or a production workspace row.

## Implemented workflow

The browser journey in `tests/e2e/outreach-workflow.spec.ts` completes:

1. Create draft.
2. Edit subject.
3. Edit message.
4. Add personalization from verified lead facts.
5. Save draft.
6. Edit and save again, producing a distinct **Draft edited** audit event.
7. Reload the draft from `?draft=…` and verify persisted subject, message, and personalization.
8. Review with a documented lawful basis and human-review checkbox.
9. Approve draft for review.
10. Export the saved draft as `outreach-draft.txt` after a server-audited export action.
11. Add a suppression record for the exact public phone.
12. View the suppression record and its “Do not contact” status.
13. View all five required audit labels in the workspace audit-log panel.
14. Assert a direct `send_message` request is rejected with HTTP 403.
15. Assert no message reached `status='sent'`, no `sent` event was recorded, and no Send button exists.

Approval remains a review state only. Export is a local text download; the server records the export before the browser downloads it. No provider is called.

## Draft-eligibility guards

The shared contract in `src/lib/outreach.ts` is enforced in both `/api/actions` and the Outreach Centre UI. A draft cannot be created when:

- no lead is selected;
- the lead has no source-backed evidence;
- the contact is suppressed;
- the contact has no public contact information for the chosen channel;
- the lead is still unverified.

The server also requires the recipient to match the public contact recorded on the verified lead. Phone formatting differences are normalized, but an unrecorded recipient is rejected. `src/app/api/actions/route.ts` returns HTTP 409 for ineligible saves; the browser disables Save, shows the exact reason, and never calls the API in those states.

`tests/e2e/outreach-workflow.spec.ts` exercises all five ineligible states in the real UI and asserts zero save, export, send, or message-row side effects. `tests/outreach-workflow.test.ts` covers the same eligibility contract plus suppressed contacts, missing evidence, unverified activity, missing public contact, recipient mismatch, public-phone formatting, audit-label presence, and send-adapter absence.

## Audit log

The server records distinct tenant-scoped `pa_audit_logs` actions:

| Action               | Trigger                                                   |
| -------------------- | --------------------------------------------------------- |
| `Draft created`      | First successful `save_message`                           |
| `Draft edited`       | Successful `save_message` with an existing owned draft ID |
| `Draft approved`     | Successful `approve_message`                              |
| `Draft exported`     | Successful `export_outreach_draft`                        |
| `Contact suppressed` | Successful `suppress`                                     |

Audit details intentionally contain only workflow metadata such as message ID, business ID, channel, status, and export format. They do not contain message bodies, recipient contact values, credentials, or provider secrets. `/api/workspace` loads `pa_audit_logs` under the existing `auth.uid()` RLS boundary; `Workspace.audit_logs` and `emptyWorkspace.audit_logs` expose the typed data to the audit-log panel.

No new database migration was required: the existing append-only `pa_audit_logs` table and policies were reused.

## Sending boundary

Sending remains disabled:

- `send_message` in `/api/actions` returns HTTP 403 with “Sending is disabled. No messaging provider is authorised. Approval never sends a message.”
- No email-send or WhatsApp-send adapter exists.
- The existing database trigger rejects `status='sent'`.
- The UI has no Send button, shows “Sending remains disabled”, and labels both messaging integrations “Not configured / Draft only”.
- Approval records only a human-review event.
- The E2E workflow uses intercepted HTTP fixtures and asserts no `sent` message or event.

No real email, WhatsApp, webhook, provider credential, or production database write was used.

## Validation results

Executed on branch `arena/4a71991c-prospectaistudio`:

- `npm run typecheck` — passed.
- `npm test` — **110 passed**.
- `npm run build` — passed; production build compiled and generated all 20 static pages.
- `npm run test:e2e` — **65 passed**, including the complete Outreach Centre workflow and all five ineligible-draft guards.
- `git diff --check` — passed.

The full E2E suite also retained the existing unauthenticated API guard, responsive-layout, keyboard-dismissal, and WCAG AA automated checks for `/outreach`.

## Boundaries

- Intercept-only authenticated browser fixtures were used; no test users or fixtures were created in production.
- No live Ollama/AI, discovery, email, WhatsApp, or website-publishing provider was called.
- No claim is made that a message was delivered, a website was published, or a business is currently operating.
- Suppression records are test-only interception state; the production suppression table was not modified.
- The two-user live Supabase RLS execution remains a separate non-production-environment task; this validation used repository-contained tests and existing RLS-scoped workspace loading.
