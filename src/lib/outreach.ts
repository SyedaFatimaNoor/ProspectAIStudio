import type { Business, Run } from "./types";

export type OutreachChannel = "email" | "whatsapp";

export type OutreachLead = Pick<
  Business,
  | "id"
  | "name"
  | "category"
  | "city"
  | "country"
  | "phone"
  | "email"
  | "website"
  | "source_url"
  | "provider"
  | "source_id"
  | "activity_status"
  | "verification_status"
  | "source_observed_at"
  | "facts"
>;

export type OutreachSourceEvidence = {
  business_id: string;
  observed_at?: string | null;
};

export type OutreachBlockCode =
  | "no_lead"
  | "unverified"
  | "no_evidence"
  | "no_public_contact"
  | "suppressed"
  | "recipient_mismatch";

export type OutreachEligibility = {
  allowed: boolean;
  code?: OutreachBlockCode;
  reason?: string;
};

export type OutreachEligibilityInput = {
  business?: OutreachLead | null;
  channel: OutreachChannel | string;
  recipient: string;
  suppressions: { contact: string }[];
  runs?: Pick<Run, "business_id" | "status" | "evidence">[];
  sources?: OutreachSourceEvidence[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normaliseOutreachContact(value: string) {
  return value.trim().toLocaleLowerCase();
}

function contactDigits(value: string) {
  return normaliseOutreachContact(value).replace(/[^\d+]/g, "");
}

export function outreachContactsMatch(a: string, b: string) {
  if (normaliseOutreachContact(a) === normaliseOutreachContact(b)) return true;
  const digitsA = contactDigits(a);
  const digitsB = contactDigits(b);
  return digitsA.length >= 8 && digitsB.length >= 8 && digitsA === digitsB;
}

export function publicContactForChannel(
  business: OutreachLead | null | undefined,
  channel: OutreachChannel | string,
) {
  if (!business) return "";
  const value = channel === "email" ? business.email : business.phone;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function hasOutreachEvidence(
  business: OutreachLead | null | undefined,
  runs: Pick<Run, "business_id" | "status" | "evidence">[] = [],
  sources: OutreachSourceEvidence[] = [],
) {
  if (!business) return false;
  const runEvidence = runs.some(
    (run) =>
      run.business_id === business.id &&
      run.status === "completed" &&
      Array.isArray(run.evidence) &&
      run.evidence.length > 0,
  );
  const sourceEvidence =
    Boolean(business.source_observed_at) ||
    sources.some(
      (source) =>
        source.business_id === business.id && Boolean(source.observed_at),
    );
  const facts = isRecord(business.facts) ? business.facts : {};
  const factEvidence = Array.isArray(facts.evidence)
    ? facts.evidence.some(
        (item) =>
          isRecord(item) &&
          typeof item.url === "string" &&
          /^https?:\/\//i.test(item.url),
      )
    : false;
  return runEvidence || sourceEvidence || factEvidence;
}

/**
 * Server and browser share this contract. It deliberately requires a verified,
 * evidenced lead and an exact source-recorded public contact; it never sends.
 */
export function outreachEligibility({
  business,
  channel,
  recipient,
  suppressions,
  runs = [],
  sources = [],
}: OutreachEligibilityInput): OutreachEligibility {
  if (!business)
    return {
      allowed: false,
      code: "no_lead",
      reason: "Select a verified lead before creating an outreach draft.",
    };
  if (business.activity_status !== "verified_active")
    return {
      allowed: false,
      code: "unverified",
      reason: "Verify business activity before creating an outreach draft.",
    };
  if (!hasOutreachEvidence(business, runs, sources))
    return {
      allowed: false,
      code: "no_evidence",
      reason:
        "Record source-backed verification evidence before creating an outreach draft.",
    };
  const publicContact = publicContactForChannel(business, channel);
  if (!publicContact)
    return {
      allowed: false,
      code: "no_public_contact",
      reason:
        "No public contact information is available for this lead and channel.",
    };
  if (
    suppressions.some((entry) =>
      outreachContactsMatch(entry.contact, recipient),
    )
  )
    return {
      allowed: false,
      code: "suppressed",
      reason: "This contact is on the suppression list. Do not create a draft.",
    };
  if (!outreachContactsMatch(recipient, publicContact))
    return {
      allowed: false,
      code: "recipient_mismatch",
      reason:
        "Recipient must match the public contact recorded on the verified lead.",
    };
  return { allowed: true };
}
