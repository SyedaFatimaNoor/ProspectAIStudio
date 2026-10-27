# Providers, evidence, and limits

## OpenStreetMap / Overpass

- Supplies public listing names, category tags, coordinates, addresses, website links, and business contacts when available.
- **Credentials:** none. An explicit `OVERPASS_URL` is required; administrators must review the selected endpoint's usage policy before enabling it.
- **Cost/limits:** no contractual free quota. Public shared endpoints have resource and load limits. Do not treat them as unrestricted infrastructure. Consider a self-hosted endpoint for sustained usage.
- **Attribution:** © OpenStreetMap contributors, Open Database License (ODbL). Preserve provenance and attribution on exports/reuse where required. The application stores attribution in `facts`.
- **Query scope:** exact country and city administrative boundary names (`name` or `name:en`); eight mapped categories; optional post-query name keyword filter. Service area is research context, not a geospatial filter. Maximum 100 returned leads; response candidates capped at 300, response body at 3 MB, Overpass query at 35 seconds and client request at 45 seconds.
- **Rate policy:** one request at a time per worker, at least ten seconds between discovery jobs; exponential retry backoff (60, 120 seconds, final failure), maximum three attempts. For shared public Overpass, run **one worker**. Multiple workers are lease-safe but do not share a global provider rate limiter.
- **Cancellation:** pause/cancel stops database processing at the next record boundary. An already-issued source request may complete; its returned records are not written after cancellation. Resume may re-query the source; reconciliation prevents duplicate businesses and source rows.
- **Failure:** incomplete Overpass responses, rate limits, parse errors, oversized responses, and timeouts are errors, not successful empty searches. Zero returned records after a valid response is a legitimate empty result. Missing or ambiguous boundary coverage can produce empty results.
- **Freshness:** OSM listing presence and last-edit timestamps are not evidence of currently operating status. No review content is scraped. No Google Maps scraping is performed.

The public map illustration uses Natural Earth land geometry distributed in `world-atlas` (public-domain cartographic data). It is not a live discovery map.

## Optional cloud scheduler

See [CLOUD_WORKER.md](CLOUD_WORKER.md). Cloud mode has a database-enforced global five-minute cooldown and 20 discovery attempts/day, plus transactional source writes. It never performs business-URL HTTP requests: completed reviews clearly record a **listing-only** scope and require human evidence review. The DNS-pinned website checks below describe the alternative Node worker, not the Edge Function. Do not run both workers concurrently.

## Website verification

`BusinessProvider`, `WebsiteSearchProvider`, and `AIProvider` isolate integrations from UI and persistence.

The initial website-search adapter considers URLs supplied by the source listing. The status checker:

1. Validates public HTTP(S) URLs on ports 80/443.
2. Blocks loopback, private, link-local, metadata, reserved, and IPv4-mapped IPv6 ranges.
3. Resolves DNS with a time budget, rejects mixed public/private answers, and pins the HTTP connection to a validated address to prevent DNS rebinding.
4. Makes bounded HEAD requests, manually revalidating each redirect (maximum four requests).
5. Records HTTP status, redirects, errors, source URL, and observation time.
6. Classifies known social, directory, and parking-provider domains separately from possible official sites.
7. Returns **manual review required**. HTTP reachability is not ownership proof. A timeout, denied HEAD, missing link, parking candidate, or DNS failure never establishes website absence.

**Not implemented:** a broad permitted search-engine adapter, page-content identity matching, review freshness sources, registrant/availability checks, or automated high-confidence absence determinations. Redirects to unknown hosts remain candidates. Parking detection is limited to known parking-provider hosts, not content analysis. Additional permitted sources must be integrated and tested before stronger automation claims.

### Explainable rubric

Scores are review aids, not calibrated probabilities:

| Assessment                                        | Activity score | Website score | Basis                                                                                                          |
| ------------------------------------------------- | -------------: | ------------: | -------------------------------------------------------------------------------------------------------------- |
| Initial discovery                                 |              0 |             0 | No assessment yet                                                                                              |
| Automated listing/HEAD review                     |             20 |            20 | Listing supports possible identity, but current operation and official ownership/absence are unconfirmed       |
| Manual active assessment                          |             85 |   independent | User attests to recent reviewed evidence and records URL, observation date, and reasoning                      |
| Manual closed/inactive assessment                 |             75 |   independent | Reviewer records contrary activity evidence                                                                    |
| Manual official website / high-confidence absence |    independent |            85 | Reviewer attestation with explanation; absence requires two different source hosts and documented search scope |
| Manual uncertainty                                |             25 |            20 | Insufficient reviewed evidence                                                                                 |

Manual observations must be within the last 90 days. Different hosts are a minimum corroboration check, **not proof of independence**. Reviewers must ensure substantive evidence and lawful access. The app cannot detect false human attestations. The preferred confidence threshold in Settings is a research preference, not permission to bypass evidence requirements.

## Optional AI

- Ollama Cloud uses the server-side `OLLAMA_API_KEY` and native `https://ollama.com/api/chat` endpoint with `gemma4:31b`.
- Existing OpenAI-compatible `/chat/completions` configuration remains available through `AI_BASE_URL`, `AI_MODEL`, and optional `AI_API_KEY`.
- Local models require suitable hardware; no paid service is required for manual/fact-based drafts. A Vercel deployment cannot reach an Ollama instance on a developer laptop.
- Only whitelisted name, category, city, and country are sent. No contact details, notes, scraped page content, cookies, or keys are included in the prompt.
- Untrusted facts are JSON-delimited data under fixed system instructions. The model has no tools, network actions, database access, or send capability.
- 60-second timeout, bounded output, human editing and review. Provider errors are surfaced without claiming success.
- AI suggestions still need review. No generated concept is claimed to be built, published, or approved.

## Messaging

This release intentionally implements **drafts, exports, individual approval, events, and suppression only**. There are no email-send or WhatsApp-send adapters. No messages can be sent through the UI, API, or authenticated database writes; a database trigger rejects `status='sent'`.

Before adding sending: implement provider-specific authorisation, consent/lawful-basis checks, template and opt-in rules, delivery/reply webhooks with signature verification and idempotence, global rate limits, unsubscribe endpoints, and a transactional suppression check at dispatch time. Never automate a personal WhatsApp account. Configuration fields do not imply these integrations exist.
