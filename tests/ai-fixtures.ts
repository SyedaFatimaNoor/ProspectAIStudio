import type { AIConceptOutput, VerifiedLeadFacts } from "../src/lib/ai-schema";
import type {
  ConceptRepository,
  StoredConceptProposal,
} from "../src/lib/ai-workflow";

/**
 * Public-source verified lead used only by automated/live AI workflow tests.
 * It is NOT a production workspace row and contains no real user's data.
 *
 * Identity/location/category provenance:
 * - OSM node 788761098, timestamp 2026-01-30T11:55:45Z, check_date 2026-01-30:
 *   https://api.openstreetmap.org/api/0.6/node/788761098.json
 * - Official site reached 2026-11-05: https://www.ntcafe.de/
 *
 * The two public sources support a human test attestation for name, cafe
 * category, Halle (Saale), Germany, and a website candidate. They are not
 * continuous proof of current operation; ambiguous cases require manual review.
 * Contact details are deliberately excluded from the AI provider payload.
 */
export const publicVerifiedLead = {
  id: "78876109-8098-4761-b098-000000000001",
  name: "Café nt",
  category: "cafe",
  city: "Halle (Saale)",
  country: "Germany",
  phone: null,
  email: null,
  website: "https://www.ntcafe.de/",
  source_url: "https://www.openstreetmap.org/node/788761098",
  provider: "openstreetmap",
  source_id: "osm:node/788761098",
  source_observed_at: "2026-01-30T11:55:45Z",
  created_at: "2026-11-05T00:00:00.000Z",
  activity_status: "verified_active",
  verification_status: "Verified active",
  activity_confidence: 85,
  website_status: "website_found",
  website_confidence: 85,
  outreach_status: "Not contacted",
  notes: "",
  facts: {
    verified_name: "Café nt",
    verified_city: "Halle (Saale)",
    activity_status: "verified_active",
    description:
      "A public website describes a culture café in Halle with drinks and food and asks guests to reserve places; OSM lists the venue as a cafe.",
    evidence: [
      {
        url: "https://api.openstreetmap.org/api/0.6/node/788761098.json",
        observed_at: "2026-01-30T11:55:45Z",
        explanation:
          "OSM node tags supply the business name, cafe category, city, country, website candidate and check date. Listing presence is not continuous proof of current operation.",
      },
      {
        url: "https://www.ntcafe.de/",
        observed_at: "2026-11-05T00:00:00.000Z",
        explanation:
          "The reachable official site describes the café in Halle and supports a website candidate. Reachability is not ownership proof.",
      },
    ],
  },
};

export function validConcept(facts: VerifiedLeadFacts): AIConceptOutput {
  return {
    schema_version: 1,
    concept_type: "editable_website_concept",
    supported_facts: {
      name: facts.name,
      category: facts.category,
      location: `${facts.city}, ${facts.country}`,
      activity: "Manually verified active",
    },
    uncertainties: {
      contacts:
        "Email and phone details are unverified because they were not supplied as facts; leave placeholders and verify before publishing.",
      website_status:
        "Website status is unverified in this concept; a missing link is not evidence of absence and ownership requires human review.",
      services_and_offers:
        "Services and offers are unverified because they were not supplied; use owner-confirmed placeholders only.",
      hours_and_availability:
        "Opening hours and current availability are unverified; verify before publishing and avoid presenting them as facts.",
      pricing:
        "Pricing is unverified and not supplied; use an owner-confirmed price list only after human review.",
      reviews_and_claims:
        "Reviews, awards, and accomplishment claims are unverified; do not add them without owner-confirmed evidence.",
      identity_and_lawful_basis:
        "Sender identity and lawful basis are unverified; confirm both before any outreach and add a clear opt-out.",
    },
    website_copy: {
      headline: `${facts.name} in ${facts.city}`,
      subheading:
        "A calm, editable concept introduction based only on the verified business name, cafe category, and location.",
      sections: [
        {
          name: "Home",
          heading: "A clear welcome",
          body: "Introduce the cafe using only the verified name, category, and location. Keep this copy editable and add owner-confirmed details only after human review.",
        },
        {
          name: "About",
          heading: "A place to describe",
          body: "Use this space for an owner-approved story. Do not add history, staff names, awards, or claims until verified before publishing.",
        },
        {
          name: "Visit",
          heading: "Plan a visit",
          body: "Add an owner-confirmed address, opening hours, and contact method here. These details are currently unverified and must remain placeholders.",
        },
      ],
      calls_to_action: [
        {
          label: "Reserve a table",
          guidance:
            "Use this suggested label only with an owner-confirmed reservation method and verified availability before publishing.",
        },
      ],
    },
    website_structure: [
      {
        page: "Home",
        purpose:
          "Provide a concise introduction built from the verified identity and location.",
        content_notes:
          "Keep the headline and subheading editable. Any additional business claim must be verified before publishing.",
      },
      {
        page: "About",
        purpose:
          "Reserve a clearly labelled section for owner-approved background information.",
        content_notes:
          "Mark unverified story details as placeholders and require human review before replacing them.",
      },
      {
        page: "Visit",
        purpose:
          "Reserve a section for address, hours, and contact details once confirmed.",
        content_notes:
          "Do not add contacts, hours, or directions until the owner confirms them and a reviewer records provenance.",
      },
    ],
    visual_direction: {
      mood: "A calm, welcoming editorial mood is a design suggestion, not an existing brand identity.",
      palette:
        "Proposed palette: warm neutrals with a deep navy accent and a restrained blue highlight. These are design suggestions, not existing brand colours.",
      typography:
        "Use a legible humanist sans serif with generous line height; treat the type choice as a proposal for human review.",
      layout:
        "Use a single-column mobile-first layout with clear section spacing and one primary action per page.",
      accessibility:
        "Maintain strong contrast, visible focus states, semantic headings, and readable sixteen-pixel-or-larger body text.",
      imagery:
        "Use authentic photography only with owner-confirmed rights and permission; otherwise use neutral placeholders.",
    },
    review_notes: [
      {
        topic: "activity",
        guidance:
          "Recheck current operation before publication; a reviewer attestation is not continuous proof.",
      },
      {
        topic: "website_status",
        guidance:
          "Confirm website ownership separately; a missing link is not evidence of absence.",
      },
      {
        topic: "contacts",
        guidance:
          "Do not publish contact details until the owner confirms them and provenance is recorded.",
      },
      {
        topic: "content_rights",
        guidance:
          "Confirm permission for all imagery, logos, and text before publishing or exporting.",
      },
      {
        topic: "lawful_basis",
        guidance:
          "Confirm a lawful basis, sender identity, and opt-out before any outreach use.",
      },
    ],
  };
}

export function validConceptJson(facts: VerifiedLeadFacts) {
  return JSON.stringify(validConcept(facts));
}

export function memoryConceptRepository() {
  const rows = new Map<string, StoredConceptProposal>();
  const calls = { insert: 0, update: 0 };
  let sequence = 0;
  const repository: ConceptRepository & {
    rows: Map<string, StoredConceptProposal>;
    calls: typeof calls;
  } = {
    rows,
    calls,
    async insertProposal(values) {
      calls.insert++;
      const proposal: StoredConceptProposal = {
        ...values,
        id: `ai-concept-${++sequence}`,
        created_at: "2026-11-05T00:00:00.000Z",
        updated_at: "2026-11-05T00:00:00.000Z",
      };
      rows.set(proposal.id, proposal);
      return proposal;
    },
    async updateProposal(id, values) {
      calls.update++;
      const prior = rows.get(id);
      if (!prior) throw new Error("Proposal not found.");
      const proposal: StoredConceptProposal = {
        ...values,
        id,
        created_at: prior.created_at,
        updated_at: "2026-11-05T00:01:00.000Z",
      };
      rows.set(id, proposal);
      return proposal;
    },
  };
  return repository;
}
