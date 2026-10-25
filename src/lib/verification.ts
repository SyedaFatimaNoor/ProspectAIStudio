import type { Business, Evidence } from "./types";
import { checkURL, type URLCheck } from "./safe-url";
export type CandidateKind =
  "social_profile" | "directory" | "parking_provider" | "official_candidate";
export function classifyCandidate(value: string): CandidateKind {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  const is = (domains: string[]) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));
  if (
    is([
      "facebook.com",
      "instagram.com",
      "tiktok.com",
      "linkedin.com",
      "wa.me",
      "whatsapp.com",
      "x.com",
      "twitter.com",
    ])
  )
    return "social_profile";
  if (
    is([
      "yelp.com",
      "tripadvisor.com",
      "google.com",
      "maps.app.goo.gl",
      "yellowpages.com",
      "openstreetmap.org",
      "linktr.ee",
    ])
  )
    return "directory";
  if (is(["sedo.com", "afternic.com", "parkingcrew.net"]))
    return "parking_provider";
  return "official_candidate";
}
export interface WebsiteSearchProvider {
  search(business: Business): Promise<{ url: string; source: string }[]>;
}
export class ListingWebsiteSearch implements WebsiteSearchProvider {
  async search(b: Business) {
    return b.website
      ? [{ url: b.website, source: b.source_url || "Public listing" }]
      : [];
  }
}
export async function verifyBusiness(
  b: Business,
  checker: (url: string) => Promise<URLCheck> = checkURL,
  search: WebsiteSearchProvider = new ListingWebsiteSearch(),
) {
  const timestamp = new Date().toISOString();
  const evidence: Evidence[] = [
    {
      type: "Public listing",
      detail: `${b.name} was discovered in ${b.city}, ${b.country}. A listing does not independently establish current operation.`,
      url: b.source_url || undefined,
      timestamp,
    },
  ];
  const candidates = await search.search(b);
  const results: {
    url: string;
    classification: CandidateKind;
    result: URLCheck;
  }[] = [];
  for (const candidate of candidates.slice(0, 3)) {
    let classification: CandidateKind;
    try {
      classification = classifyCandidate(candidate.url);
    } catch {
      evidence.push({
        type: "Invalid URL",
        detail:
          "The listing contained an invalid website value. Manual review required.",
        timestamp,
      });
      continue;
    }
    const result = await checker(candidate.url);
    if (result.status !== null) {
      try {
        const finalKind = classifyCandidate(result.final_url);
        if (finalKind !== "official_candidate") classification = finalKind;
      } catch {}
    }
    results.push({ url: candidate.url, classification, result });
    evidence.push({
      type:
        classification === "official_candidate"
          ? "Website candidate"
          : "Non-official profile",
      detail: result.error
        ? `${result.error} No absence inference was made.`
        : `Source-linked URL returned HTTP ${result.status}; final classification: ${classification}. Reachability does not prove official ownership.`,
      url: candidate.url,
      timestamp,
    });
  }
  if (!candidates.length)
    evidence.push({
      type: "Missing website link",
      detail:
        "No candidate URL was supplied by the configured listing provider. No independent domain search provider is configured. Absence is uncertain.",
      url: b.source_url || undefined,
      timestamp,
    });
  const explanation =
    "Manual review required. Activity confidence is 20/100 because a public listing supports identity but provides no independently confirmed recent operation. Website confidence is 20/100 because listing links and HTTP responses cannot establish ownership or absence. Broader permitted research is required. No high-confidence absence claim was made.";
  return {
    activity_status: "manual_review",
    website_status: results.some(
      (r) => r.classification === "official_candidate",
    )
      ? "candidate_found"
      : results.some((r) => r.classification === "social_profile")
        ? "social_only_candidate"
        : "manual_review",
    activity_confidence: 20,
    website_confidence: 20,
    verification_status: "Manual review required",
    evidence,
    explanation,
    candidates: results,
  };
}
