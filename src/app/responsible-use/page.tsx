import Link from "next/link";
import { PolicyPage } from "@/components/policy-page";
import { publicMetadata } from "@/lib/site";

export const metadata = publicMetadata(
  "/responsible-use",
  "Responsible use · ProspectAI",
  "ProspectAI guidance for permitted data sources, honest evidence, human review, privacy, opt-outs and draft-only outreach.",
);
export default function ResponsibleUse() {
  return (
    <PolicyPage
      title="Responsible use"
      introduction="Research real businesses. Keep evidence honest. Make thoughtful decisions—not unsupported claims or unapproved contact."
    >
      <nav className="policy-contents" aria-label="On this page">
        <a href="#sources">Permitted sources</a>
        <a href="#evidence">Evidence standards</a>
        <a href="#outreach">Outreach boundaries</a>
        <a href="#concepts">Concepts & AI</a>
        <a href="#limits">Limits & availability</a>
      </nav>
      <section id="sources">
        <h2>1. Use permitted sources</h2>
        <p>
          Use public APIs, datasets or other sources you are authorised to
          access. Respect licensing, attribution, platform rules and rate
          limits. OpenStreetMap-derived records require appropriate
          OpenStreetMap contributor and ODbL attribution when reused.
        </p>
        <p>
          Do not bypass authentication, paywalls, CAPTCHAs, provider blocks or
          rate limits. Do not assume Google Maps scraping is permitted. This
          release does not implement Google Maps scraping, personal WhatsApp
          automation or collection from private accounts.
        </p>
        <p>
          If a provider denies a request or is unavailable, preserve the failure
          and resolve access legitimately. Do not rotate endpoints to evade
          restrictions, or replace failed searches with invented businesses.
        </p>
      </section>
      <section id="evidence">
        <h2>2. Separate evidence from assumptions</h2>
        <ul>
          <li>
            A public listing is not independent proof that a business is
            currently operating.
          </li>
          <li>
            A missing website link, timeout, blocked request or failed domain
            check is not proof that no website exists.
          </li>
          <li>
            A reachable website is a candidate, not proof of official ownership.
          </li>
          <li>
            Activity and website assessments must remain independent, with
            source links, observation times and explanations.
          </li>
        </ul>
        <p>
          Confidence scores are explainable review aids, not calibrated
          probabilities. Cloud listing-only review does not fetch business
          websites or perform an independent domain search. Ambiguous cases
          require human review. Stronger conclusions require recent, relevant,
          corroborated evidence—not simply a high score.
        </p>
      </section>
      <section>
        <h2>3. Minimise data and honour privacy</h2>
        <p>
          Keep only information needed for a legitimate, lawful business
          purpose. Public business contact details can still identify
          individuals. Do not enrich records with sensitive personal
          information, private contact lists or unrelated personal profiles.
        </p>
        <p>
          Use deletion and retention controls, keep account access secure and
          preserve opt-outs. See{" "}
          <Link href="/privacy">Privacy &amp; data handling</Link> for what this
          build stores and the limits of its deletion controls.
        </p>
      </section>
      <section id="outreach">
        <h2>4. Outreach stays draft-only</h2>
        <p>
          This release can save, edit, review, approve and export outreach
          drafts. It has no sending adapters. Approval is not delivery, and no
          draft should be represented as a sent message.
        </p>
        <p>
          Before using any exported draft, check the recipient, factual claims,
          your identity, applicable law, lawful basis or required consent, and
          the channel provider’s rules. Provide an appropriate opt-out and
          honour it. Do not use drafts for deceptive impersonation, harassment,
          unapproved bulk contact or personal WhatsApp automation.
        </p>
        <p>
          Suppression records protect matching contacts inside this application.
          If you export data to another tool, you remain responsible for
          carrying those opt-outs forward; an export cannot enforce another
          system’s behaviour.
        </p>
      </section>
      <section id="concepts">
        <h2>5. Concepts are not delivered websites</h2>
        <p>
          Generated or manually prepared concepts are editable suggestions. They
          are not built, published, approved or delivered websites. Do not
          invent services, prices, opening hours, customer reviews, contact
          details or achievements.
        </p>
        <p>
          AI is optional. Treat model output as unverified and review every
          claim. Untrusted listing or website text must not override application
          instructions or authorise actions. No model output authorises sending,
          deployment or access to another person’s account.
        </p>
      </section>
      <section id="limits">
        <h2>6. Respect availability and limits</h2>
        <p>
          Live discovery needs a permitted, functioning source and an enabled
          worker. A job marked queued has not completed a search. A failed
          request must remain a visible failure. Coverage and freshness vary by
          location and provider.
        </p>
        <p>
          Free-tier hosting and public endpoints have quotas and restrictions;
          free operation is not guaranteed indefinitely. Optional cloud
          discovery uses a processing cap and bounded retries. Any paid service,
          account billing or increase in resource use must be reviewed by the
          deployment operator.
        </p>
      </section>
      <section className="policy-callout">
        <h2>When uncertain, stop and review</h2>
        <p>
          Keep the source, record what is unknown, and ask a human to assess the
          evidence. A transparent limitation is more useful than a confident
          claim the data does not support.
        </p>
      </section>
      <p>
        Questions about your account or deployment should go to your operator
        through their verified contact channel. Do not share passwords or API
        secrets in public reports.
      </p>
    </PolicyPage>
  );
}
