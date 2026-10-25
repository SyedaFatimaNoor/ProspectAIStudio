import Link from "next/link";
import { PolicyPage } from "@/components/policy-page";
import { publicMetadata } from "@/lib/site";

export const metadata = publicMetadata(
  "/privacy",
  "Privacy & data handling · ProspectAI",
  "Understand the account data, public business evidence, session cookies, retention controls and optional AI processing used by ProspectAI.",
);
export default function Privacy() {
  return (
    <PolicyPage
      title="Privacy & data handling"
      introduction="A practical explanation of what this application handles, why it handles it, and the controls available to you."
    >
      <nav className="policy-contents" aria-label="On this page">
        <a href="#scope">About this notice</a>
        <a href="#data">Data we handle</a>
        <a href="#providers">Service providers</a>
        <a href="#retention">Retention</a>
        <a href="#controls">Your controls</a>
        <a href="#contact">Requests & operator details</a>
      </nav>
      <section id="scope">
        <h2>1. About this notice</h2>
        <p>
          ProspectAI is an evidence-first business research application. The
          deployment operator—the person or organisation running your
          instance—is responsible for deciding how it is used and for providing
          any legally required operator identity, contact details and
          jurisdiction-specific terms. This notice describes the product
          implementation; it does not claim legal compliance in every
          jurisdiction.
        </p>
      </section>
      <section id="data">
        <h2>2. Data the application handles</h2>
        <ul>
          <li>
            <strong>Account and session data:</strong> your sign-in email,
            optional display name, account identifier and session cookies.
            Supabase Auth manages authentication; the application does not store
            a separate plaintext password database.
          </li>
          <li>
            <strong>Business research:</strong> names, categories, locations,
            source-linked website candidates and business contact details when
            supplied by a permitted public source.
          </li>
          <li>
            <strong>Your workspace content:</strong> search requests, notes,
            evidence URLs, assessments, website concepts, proposals and outreach
            drafts you choose to save.
          </li>
          <li>
            <strong>Operational records:</strong> job progress, source
            observation timestamps, failures, audit events, preferences and
            suppression records used to honour opt-outs.
          </li>
        </ul>
        <p>
          Public availability does not remove privacy obligations. Collect only
          information needed for a legitimate business purpose. Do not add
          sensitive personal information, private customer lists, passwords or
          API keys to notes, prompts or drafts.
        </p>
      </section>
      <section>
        <h2>3. Purpose, sessions and access</h2>
        <p>
          Account information enables sign-in and workspace persistence.
          Research data supports evidence review and user-edited proposals.
          Session cookies allow the browser and server to recognise your
          authenticated account; they are not advertising cookies.
        </p>
        <p>
          Workspace reads and protected changes use authenticated access.
          Supabase row-level policies isolate application records by account.
          Hosting and authentication providers may process request metadata and
          security logs under their own terms. No advertising tracker is
          included in this application build.
        </p>
      </section>
      <section id="providers">
        <h2>4. Service providers and optional AI</h2>
        <p>
          The current deployment uses Vercel for the website and Supabase for
          authentication, database storage and optional cloud processing.
          Configured public-data providers supply listings;
          OpenStreetMap-derived records retain source links and attribution.
          Coverage and accuracy are not guaranteed.
        </p>
        <p>
          AI is optional. When you request an AI concept, the application sends
          only the selected business name, category, city and country in the
          prompt to the configured compatible model provider. Contact details,
          private notes and application secrets are not included in that prompt.
          The provider receives the request and processes it under its own
          terms; operators must review those terms before enabling it.
        </p>
        <p>
          Outreach is draft-only in this release. Saving or approving a draft
          does not send it to a recipient. You control any later use of exported
          content.
        </p>
      </section>
      <section id="retention">
        <h2>5. Retention and deletion</h2>
        <p>
          The research retention preference defaults to 90 days and can be set
          between 7 and 365 days in Settings. Cleanup requires an enabled worker
          or a manual cleanup action; records are not guaranteed to disappear at
          the chosen deadline while processing is paused.
        </p>
        <p>
          Deleting a business removes its related source records, verification
          evidence, proposals and outreach drafts through database
          relationships. Suppression records are retained separately to avoid
          contacting someone who has opted out. Account records, audit events
          and provider-managed backups have separate lifecycles; the research
          retention setting is not a promise to delete every category of data or
          every backup.
        </p>
      </section>
      <section id="controls">
        <h2>6. Controls available to you</h2>
        <p>
          You can edit workspace notes and drafts, export the visible business
          fields as CSV, export proposals, delete selected business research,
          adjust retention preferences and run research cleanup in Settings.
          Suppression controls record opt-outs and prevent matching drafts from
          being approved.
        </p>
        <p>
          The application does not currently offer a complete self-service
          account export or account-deletion screen. For those requests, contact
          your deployment operator. Do not treat the available CSV export as a
          full copy of all account data.
        </p>
      </section>
      <section id="contact" className="policy-callout">
        <h2>7. Requests and operator details</h2>
        <p>
          For privacy questions, account deletion or access requests, use a
          verified contact channel supplied by the operator of your instance. A
          dedicated privacy support address is not configured in this build. Do
          not post personal data, session tokens or credentials in a public
          issue tracker.
        </p>
        <p>
          <strong>For deployment operators:</strong> publish your verified
          privacy contact and any required legal identity, lawful-basis and
          regional information before accepting public registrations. This
          product notice is not a substitute for those obligations.
        </p>
      </section>
      <p>
        See also our{" "}
        <Link href="/responsible-use">responsible-use guidance</Link> for source
        access, evidence standards and outreach boundaries.
      </p>
    </PolicyPage>
  );
}
