# Website Studio workflow validation

Validated on `arena/df47de26-prospectaistudio` on 2026-11-05. The browser workflow uses **test-only intercepted HTTP responses** and does not touch production workspace rows, real user records, a live AI key, or a real website deployment.

## Verified test lead

A public, source-backed verified lead fixture is used: **Café nt**, with provenance from OpenStreetMap node 788761098 (`https://api.openstreetmap.org/api/0.6/node/788761098.json`) and its official site (`https://www.ntcafe.de/`). The fixture records source timestamps and explicitly states that listing presence and website reachability are not continuous proof of current operation. Contact details are not invented; the structured editor starts with owner-confirmed placeholders.

The optional AI draft is simulated in the browser workflow with an intercepted `generate_concept` response carrying `Ollama Cloud · gemma4:31b` metadata. No live provider request, production database write, email, WhatsApp message, deployment, or publish action was performed.

## Workflow executed

`tests/e2e/studio-workflow.spec.ts` runs the following steps in the actual Next.js UI:

1. Select the verified Café nt test business.
2. Create a fact-based draft without AI.
3. Generate the optional AI draft.
4. Edit the headline.
5. Edit services.
6. Edit contact details with owner-confirmed placeholders.
7. Edit the call to action.
8. Edit visual direction.
9. Save the concept.
10. Reload the page.
11. Confirm the saved concept and structured fields persist.
12. Create a new version and confirm the revision increments.
13. Preview the desktop layout.
14. Preview the mobile layout.
15. Export `website-concept.md`.

The test also confirms there is no publish button and that the preview panel states: “No website is created, deployed, or published.”

## Required Studio display

When a concept is open, the Studio status panel clearly shows:

- **Draft status** — `Draft` and `Not published`.
- **Source business** — the selected verified lead and its source ID.
- **Evidence used** — AI facts-snapshot evidence, verification evidence, source provenance, and independent confidence state.
- **Last saved time** — from the persisted proposal timestamp; `Not saved yet` before the first save.
- **AI provider and model** — `Ollama Cloud · gemma4:31b` when AI is used, otherwise `Not used — fact-based/manual draft`.
- **“Not published” status** — visible in the status badges, exported Markdown, and layout-preview copy.

## Validation results

- `npm run typecheck` — passed.
- `npm test` — **100 passed**.
- `npm run build` — passed.
- `npm run test:e2e` — **63 passed**.
- `git diff --check` — passed.

No real website was created, deployed, or published.
