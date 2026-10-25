# Website review — P0 implementation

Scope: technical public-site hygiene and real privacy/responsible-use destinations only. Existing landing design, workspace flows, authentication, schema and provider configuration are preserved. P1 onboarding, validation, typography and performance recommendations are not part of this change.

## Implemented

- `/robots.txt` advertises the fixed production sitemap. `/sitemap.xml` lists exactly `/`, `/privacy` and `/responsible-use`; it contains no workspace records, auth URLs, `/home` alias or fabricated modification dates.
- Public pages have distinct canonical, Open Graph and Twitter metadata. Canonical URLs use `https://prospectaistudio.vercel.app`, never the request host or a temporary preview hostname. Next normalises the root canonical without a trailing slash; both forms identify the same root URL.
- A real 1200×630 PNG share image, SVG icon, multi-resolution ICO favicon and 180×180 Apple touch icon are served from `public/`. These are deterministic, locally generated brand graphics—not screenshots of fabricated metrics. Regenerate with `npm run assets:brand` in the Linux Chromium test environment; no remote font or production imaging service is required.
- `/home` permanently redirects (HTTP 308) to `/`. Existing root section anchors such as `/#faq` remain valid; an unnecessary duplicate `/faqs` page was not introduced.
- Both policy pages are server-rendered, mobile-readable and linked from the landing footer and sign-in screen. They describe actual data categories, retention limits, optional AI, evidence uncertainty, draft-only outreach and operator responsibilities.
- All seven workspace pages plus sign-in emit `noindex, nofollow` metadata. API/auth responses also carry `X-Robots-Tag`. Workspace pages deliberately remain crawlable so search engines can observe `noindex` and remove previously indexed URLs. Robots directives are not access control; server authentication and tenant RLS remain unchanged.
- Homepage structured data describes only a `WebSite`; it makes no offers, ratings, reviews, customer-count or compliance claims.

## Operator information still required

No verified legal operator identity, privacy contact address or jurisdiction-specific lawful-basis information was supplied. The privacy notice explicitly states this limitation rather than inventing an address or claiming universal compliance. The operator must provide those details before public registration/launch. This implementation is not legal advice or a complete jurisdiction-specific privacy policy.

## Verification

Final local production-build results (25 October 2026): build/typecheck **PASS**, **34 unit tests PASS**, **34 browser tests PASS**, full dependency audit **0 vulnerabilities**. Public pages, sign-in and anonymous discovery also produced no browser console or uncaught page errors in the final smoke check.

- Production build and TypeScript check.
- Unit tests cover route allowlisting, canonical/social metadata, crawl rules, actual PNG dimensions and favicon structure.
- Production-server browser tests request the real redirect, XML/text routes and image URLs; verify public metadata and private-route noindex; follow footer links by keyboard; and scan both policy pages for WCAG A/AA automated violations and mobile overflow.
- Existing browser regression suite covers workspace flows, denied unauthenticated writes, proposals, draft-only outreach, suppression, errors and cloud-worker scope. Fixture-backed journeys do not prove production account login or live provider availability.

The earlier live discovery provider HTTP 406 and safely paused cloud worker are unrelated to these P0 fixes. This change does not re-enable the worker, retry providers, alter billing or claim that production discovery is operational.
