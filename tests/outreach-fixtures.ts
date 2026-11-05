import type { Business, Run, Workspace } from "../src/lib/types";
import { publicVerifiedLead } from "./ai-fixtures";

/**
 * Public, source-backed verified lead for Outreach Centre workflow tests.
 *
 * OSM node 788761098 records `contact:phone="+49 345 5110712"` and
 * `contact:website="https://www.ntcafe.de"`; the normalized phone below is the
 * same public contact with formatting removed. No email address was present in
 * the OSM tags, so the fixture uses the public phone and a WhatsApp draft only.
 * It is not a production workspace row or a real user record.
 */
export const publicOutreachPhone = "+493455110712";

export const publicOutreachLead = {
  ...publicVerifiedLead,
  phone: publicOutreachPhone,
  email: null,
  website: "https://www.ntcafe.de/",
  website_status: "manual_review",
  website_confidence: 20,
  facts: {
    ...publicVerifiedLead.facts,
    public_contact: {
      channel: "whatsapp",
      value: publicOutreachPhone,
      source: "OSM contact:phone",
      url: "https://api.openstreetmap.org/api/0.6/node/788761098.json",
      observed_at: "2026-01-30T11:55:45Z",
    },
  },
};

export const outreachBusiness: Business = {
  id: publicOutreachLead.id,
  name: publicOutreachLead.name,
  category: publicOutreachLead.category,
  city: publicOutreachLead.city,
  country: publicOutreachLead.country,
  phone: publicOutreachPhone,
  email: null,
  website: publicOutreachLead.website,
  source_url: publicOutreachLead.source_url,
  source_observed_at: publicOutreachLead.source_observed_at,
  provider: publicOutreachLead.provider,
  source_id: publicOutreachLead.source_id,
  activity_status: "verified_active",
  website_status: "manual_review",
  activity_confidence: 85,
  website_confidence: 20,
  verification_status: "Verified active",
  outreach_status: "Not contacted",
  notes: "",
  created_at: "2026-11-05T00:00:00.000Z",
  facts: publicOutreachLead.facts,
};

export const outreachRun: Run = {
  id: "outreach-verification-run",
  business_id: outreachBusiness.id,
  status: "completed",
  explanation:
    "OSM node tags and the reachable official site were reviewed. Listing presence is not continuous proof of current operation; human review is required.",
  evidence: [
    {
      type: "source_link",
      detail:
        "OSM node tags supply the business name, cafe category, Halle (Saale), Germany, website candidate, public phone, and check date.",
      url: "https://api.openstreetmap.org/api/0.6/node/788761098.json",
      timestamp: "2026-01-30T11:55:45Z",
    },
    {
      type: "official_site",
      detail:
        "The reachable official site describes Café nt in Halle and supports a website candidate. Reachability is not ownership proof.",
      url: "https://www.ntcafe.de/",
      timestamp: "2026-11-05T00:00:00.000Z",
    },
  ],
  created_at: "2026-11-05T00:00:00.000Z",
  error: null,
};

export function outreachWorkspacePatch(): Partial<Workspace> {
  return {
    user: { id: "test-only-account", email: "test@example.invalid" },
    businesses: [structuredClone(outreachBusiness)],
    runs: [structuredClone(outreachRun)],
    suppressions: [],
    messages: [],
    events: [],
    audit_logs: [],
    config: { database: true, discovery: false, ai: false },
  };
}
