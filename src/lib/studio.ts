import type { Business, Proposal, Run } from "./types";

export type StudioMode = "fact_based" | "ai" | "manual";

export type StudioEvidence = {
  label: string;
  detail: string;
  url?: string;
  observed_at?: string;
};

export type StudioSections = {
  headline: string;
  services: string;
  contact: string;
  callToAction: string;
  structure: string;
  visualDirection: string;
  uncertainties: string;
};

export type StudioDocumentContext = {
  title: string;
  business: Pick<
    Business,
    | "name"
    | "category"
    | "city"
    | "country"
    | "provider"
    | "source_id"
    | "source_url"
    | "source_observed_at"
    | "verification_status"
    | "activity_confidence"
    | "website_confidence"
  >;
  mode: StudioMode;
  evidence: StudioEvidence[];
  ai?: { provider: string; model: string; generated_at: string } | null;
  lastSavedAt?: string | null;
  version?: number;
};

const categoryLabel = (value: string) =>
  value.trim().replaceAll("_", " ") || "category not recorded";

export function formatStudioTimestamp(value?: string | null) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function defaultStudioSections(
  context: Pick<StudioDocumentContext, "business">,
): StudioSections {
  const { business } = context;
  return {
    headline: `${business.name} — ${categoryLabel(business.category)} in ${business.city}`,
    services:
      "Use owner-confirmed service descriptions only. Explain confirmed offerings in plain language; add prices, awards, reviews, and claims only after human verification.",
    contact:
      "Contact details were not supplied as verified facts. Add owner-confirmed contact details, address, and opening hours only after review; leave placeholders until then.",
    callToAction:
      "Get in touch only when contact provenance, sender identity, lawful basis, and an easy opt-out have been confirmed.",
    structure:
      "1. Home — a clear introduction and one primary call to action.\n2. About — owner-approved story and business details.\n3. Services — confirmed offerings with pricing only if supplied.\n4. Contact — approved business contacts, location, and opening hours.",
    visualDirection:
      "Proposed palette: warm neutrals with a deep navy accent and a restrained blue highlight. These are design suggestions, not existing brand colours. Use accessible typography, generous spacing, and a mobile-first single-column layout. Use authentic imagery only with owner-confirmed rights.",
    uncertainties:
      "Website status is unverified in this concept; a missing link is not evidence of absence. Current operation, contacts, hours, pricing, reviews, imagery rights, and lawful basis require human review before use.",
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract one Markdown section without treating untrusted text as instructions. */
function extractSection(markdown: string, heading: string) {
  const match = new RegExp(
    `^(#{2,3})\\s+${escapeRegExp(heading)}\\s*$`,
    "im",
  ).exec(markdown);
  if (!match) return "";
  const level = match[1].length;
  const rest = markdown.slice(match.index + match[0].length);
  const stop = level <= 2 ? /^##\s+/m : /^(##|###)\s+/m;
  const end = rest.search(stop);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function firstNonEmpty(...values: string[]) {
  return values.find((value) => value.trim().length > 0)?.trim() || "";
}

export function parseStudioSections(
  markdown: string,
  context?: Pick<StudioDocumentContext, "business">,
): StudioSections {
  const fallback = context
    ? defaultStudioSections(context)
    : defaultStudioSections({
        business: {
          name: "Unselected business",
          category: "",
          city: "",
          country: "",
          provider: "not supplied",
          source_id: "",
          source_url: null,
          source_observed_at: null,
          verification_status: "Unverified",
          activity_confidence: 0,
          website_confidence: 0,
        },
      });
  return {
    headline:
      firstNonEmpty(extractSection(markdown, "Homepage headline")) ||
      fallback.headline,
    services:
      firstNonEmpty(
        extractSection(markdown, "Services and content"),
        extractSection(markdown, "Content outline"),
        extractSection(markdown, "Editable website copy"),
      ) || fallback.services,
    contact:
      firstNonEmpty(extractSection(markdown, "Contact details")) ||
      fallback.contact,
    callToAction:
      firstNonEmpty(
        extractSection(markdown, "Call to action"),
        extractSection(markdown, "Calls to action"),
        extractSection(markdown, "Recommended calls to action"),
      ) || fallback.callToAction,
    structure:
      firstNonEmpty(
        extractSection(markdown, "Website structure"),
        extractSection(markdown, "Suggested website structure"),
      ) || fallback.structure,
    visualDirection:
      firstNonEmpty(
        extractSection(markdown, "Visual direction"),
        extractSection(markdown, "Suggested visual direction"),
      ) || fallback.visualDirection,
    uncertainties:
      firstNonEmpty(
        extractSection(
          markdown,
          "Uncertain information — verify before publishing",
        ),
        extractSection(markdown, "Human review before use"),
      ) || fallback.uncertainties,
  };
}

function evidenceLines(evidence: StudioEvidence[]) {
  if (!evidence.length) return "- No evidence record was supplied.";
  return evidence
    .slice(0, 8)
    .map((item) => {
      const observed = item.observed_at
        ? ` · observed ${formatStudioTimestamp(item.observed_at)}`
        : "";
      const url = item.url ? ` · ${item.url}` : "";
      return `- ${item.label}: ${item.detail}${observed}${url}`;
    })
    .join("\n");
}

/** Serialise the editable sections into one exportable, transparent draft. */
export function composeStudioMarkdown(
  sections: StudioSections,
  context: StudioDocumentContext,
): string {
  const { business } = context;
  const ai = context.ai
    ? `${context.ai.provider} · ${context.ai.model} · generated ${formatStudioTimestamp(context.ai.generated_at)}`
    : "Not used for this draft.";
  const origin =
    context.mode === "ai"
      ? "Optional AI concept, reviewed and edited by a human"
      : context.mode === "fact_based"
        ? "Fact-based template, without AI"
        : "Human-edited concept";
  return [
    `# ${context.title || `Website concept — ${business.name}`}`,
    "Status: Draft — editable concept only.",
    "Publication: Not published. This concept has not been built, published, or approved.",
    `Source business: ${business.name} (${categoryLabel(business.category)}, ${business.city}, ${business.country}).`,
    `Source provenance: ${business.provider || "not supplied"} · ${business.source_id || "source ID not recorded"} · ${business.source_url || "source URL not recorded"}.`,
    "## Evidence used",
    evidenceLines(context.evidence),
    `Last saved: ${formatStudioTimestamp(context.lastSavedAt)}.`,
    `Revision: ${context.version ?? 0}.`,
    `AI provider and model: ${ai}`,
    `Draft origin: ${origin}.`,
    "## Verified source facts",
    `- Business: ${business.name}\n- Listed category: ${categoryLabel(business.category)}\n- Location: ${business.city}, ${business.country}\n- Verification state: ${business.verification_status}; activity ${business.activity_confidence}/100; website ${business.website_confidence}/100. Scores are review aids, not proof.`,
    "## Homepage headline",
    sections.headline,
    "## Services and content",
    sections.services,
    "## Contact details",
    sections.contact,
    "## Call to action",
    sections.callToAction,
    "## Website structure",
    sections.structure,
    "## Visual direction",
    sections.visualDirection,
    "## Uncertain information — verify before publishing",
    sections.uncertainties,
    "## Website status boundary",
    "A missing website link is not evidence of absence. Confirm current operation, official website status, contact provenance, content rights, and a lawful basis before any publication or outreach.",
    "## Publication boundary",
    "Not published. This is a saved, editable concept document. No website has been built, deployed, or published by this workflow.",
  ]
    .join("\n\n")
    .slice(0, 30000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Build the evidence list from the persisted proposal snapshot, verification
 * runs, and source provenance. It never invents contacts or website claims.
 */
export function studioEvidenceFrom({
  business,
  runs = [],
  proposal,
}: {
  business?: Business | null;
  runs?: Run[];
  proposal?: Proposal | null;
}): StudioEvidence[] {
  if (!business) return [];
  const evidence: StudioEvidence[] = [];
  const snapshot = isRecord(proposal?.facts_snapshot)
    ? proposal?.facts_snapshot
    : null;
  const snapshotEvidence = Array.isArray(snapshot?.evidence)
    ? snapshot?.evidence
    : [];
  for (const item of snapshotEvidence) {
    if (!isRecord(item)) continue;
    const url = text(item.url);
    if (!url) continue;
    evidence.push({
      label: "AI facts snapshot evidence",
      detail: text(
        item.explanation,
        "Source-backed evidence supplied with the generated concept.",
      ),
      url,
      observed_at: text(item.observed_at) || undefined,
    });
  }
  for (const run of runs) {
    if (run.business_id !== business.id) continue;
    for (const item of run.evidence || []) {
      evidence.push({
        label: `Verification evidence · ${text(item.type, "record")}`,
        detail: text(item.detail, "Evidence detail was not recorded."),
        url: text(item.url) || undefined,
        observed_at: text(item.timestamp) || undefined,
      });
    }
    if (run.explanation.trim())
      evidence.push({
        label: "Verification explanation",
        detail: run.explanation.trim(),
        observed_at: text(run.created_at) || undefined,
      });
  }
  evidence.push({
    label: "Source provenance",
    detail: `${business.provider || "Provider not recorded"} · ${business.source_id || "source ID not recorded"} · ${business.source_url || "source URL not recorded"}. Source timestamps are provenance, not continuous proof of current operation.`,
    url: business.source_url || undefined,
    observed_at: business.source_observed_at || undefined,
  });
  evidence.push({
    label: "Verification state",
    detail: `${business.verification_status || "Unverified"}; activity ${business.activity_confidence}/100; website ${business.website_confidence}/100. Independent confidence fields are review aids, not proof of absence or current operation.`,
  });
  const seen = new Set<string>();
  return evidence
    .filter((item) => {
      const key = `${item.label}|${item.detail}|${item.url || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}
