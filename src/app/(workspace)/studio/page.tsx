"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  WandSparkles,
  FileText,
  Save,
  Download,
  Sparkles,
  LayoutTemplate,
  ShieldCheck,
  ChevronRight,
  PenLine,
  MonitorSmartphone,
  RefreshCw,
  Monitor,
  Smartphone,
  Layers,
  Eye,
} from "lucide-react";
import {
  PageHeading,
  Panel,
  Field,
  Notice,
  Badge,
  Spinner,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { factBasedConcept } from "@/lib/proposal";
import { download } from "@/lib/utils";
import {
  composeStudioMarkdown,
  defaultStudioSections,
  formatStudioTimestamp,
  parseStudioSections,
  studioEvidenceFrom,
  type StudioDocumentContext,
  type StudioMode,
  type StudioSections,
} from "@/lib/studio";
import type { AIConceptOutput } from "@/lib/ai-schema";
import type { Proposal } from "@/lib/types";

type ConceptMeta = {
  provider: string;
  model: string;
  generated_at: string;
  version: number;
  proposal_id: string;
};

type GeneratedConceptResponse = {
  content: string;
  title: string;
  provider: string;
  model: string;
  generated_at: string;
  concept: AIConceptOutput;
  facts_snapshot: unknown;
  regenerated: boolean;
  proposal: Proposal;
};

type SavedProposalResponse = Partial<Proposal>;

const emptyBusiness: StudioDocumentContext["business"] = {
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
};

const emptySections = defaultStudioSections({ business: emptyBusiness });

function syncStudioUrl(leadId: string, proposalId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (leadId) url.searchParams.set("lead", leadId);
  else url.searchParams.delete("lead");
  if (proposalId) url.searchParams.set("proposal", proposalId);
  else url.searchParams.delete("proposal");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function Studio() {
  const { data, action, notify } = useWorkspace();
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<StudioSections>(emptySections);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [meta, setMeta] = useState<ConceptMeta | null>(null);
  const [mode, setMode] = useState<StudioMode>("manual");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [routeProposalId, setRouteProposalId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const hydratedRef = useRef<{ id: string; version: number } | null>(null);

  const lead = data.businesses.find((b) => b.id === leadId);
  const verified = lead?.activity_status === "verified_active";
  const selectedProposal =
    data.proposals.find((p) => p.id === selected) || null;
  const evidence = lead
    ? studioEvidenceFrom({
        business: lead,
        runs: data.runs,
        proposal: selectedProposal,
      })
    : [];

  function buildContext(
    overrides: Partial<StudioDocumentContext> = {},
  ): StudioDocumentContext {
    return {
      title: overrides.title ?? title,
      business: overrides.business ?? lead ?? emptyBusiness,
      mode: overrides.mode ?? mode,
      evidence: overrides.evidence ?? evidence,
      ai:
        overrides.ai !== undefined
          ? overrides.ai
          : meta
            ? {
                provider: meta.provider,
                model: meta.model,
                generated_at: meta.generated_at,
              }
            : null,
      lastSavedAt:
        overrides.lastSavedAt !== undefined
          ? overrides.lastSavedAt
          : lastSavedAt,
      version: overrides.version ?? version,
    };
  }

  const documentContext = buildContext();

  function loadDocument(text: string, context: StudioDocumentContext) {
    setContent(text);
    setSections(parseStudioSections(text, context));
  }

  function loadProposal(p: Proposal) {
    const proposalLead =
      data.businesses.find((b) => b.id === p.business_id) || lead;
    const nextMeta =
      p.origin === "ai" && p.ai_provider && p.ai_model && p.generated_at
        ? {
            provider: p.ai_provider,
            model: p.ai_model,
            generated_at: p.generated_at,
            version: p.version,
            proposal_id: p.id,
          }
        : null;
    const nextMode: StudioMode =
      p.origin === "ai"
        ? "ai"
        : p.origin === "manual"
          ? "manual"
          : "fact_based";
    const nextSavedAt = p.updated_at || p.created_at || null;
    const nextEvidence = proposalLead
      ? studioEvidenceFrom({
          business: proposalLead,
          runs: data.runs,
          proposal: p,
        })
      : [];
    const context = buildContext({
      title: p.title,
      business: proposalLead || emptyBusiness,
      mode: nextMode,
      evidence: nextEvidence,
      ai: nextMeta
        ? {
            provider: nextMeta.provider,
            model: nextMeta.model,
            generated_at: nextMeta.generated_at,
          }
        : null,
      lastSavedAt: nextSavedAt,
      version: p.version,
    });
    setLeadId(p.business_id);
    setTitle(p.title);
    setSelected(p.id);
    setMeta(nextMeta);
    setMode(nextMode);
    setLastSavedAt(nextSavedAt);
    setVersion(p.version);
    setError("");
    setPreviewOpen(false);
    setRouteProposalId(p.id);
    hydratedRef.current = { id: p.id, version: p.version };
    syncStudioUrl(p.business_id, p.id);
    loadDocument(p.content, context);
  }

  function resetForLead(nextLeadId: string) {
    setLeadId(nextLeadId);
    setSelected(null);
    setContent("");
    setTitle("");
    setSections(emptySections);
    setMeta(null);
    setMode("manual");
    setLastSavedAt(null);
    setVersion(0);
    setError("");
    setPreviewOpen(false);
    setRouteProposalId(null);
    hydratedRef.current = null;
    syncStudioUrl(nextLeadId, null);
  }

  function updateSection(key: keyof StudioSections, value: string) {
    const next = { ...sections, [key]: value };
    setSections(next);
    setContent(composeStudioMarkdown(next, documentContext));
  }

  function changeTitle(value: string) {
    setTitle(value);
    setContent(composeStudioMarkdown(sections, buildContext({ title: value })));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLeadId(params.get("lead") || "");
    setRouteProposalId(params.get("proposal"));
  }, []);

  useEffect(() => {
    if (!routeProposalId) return;
    const proposal = data.proposals.find((p) => p.id === routeProposalId);
    if (!proposal) return;
    const hydrated = hydratedRef.current;
    if (
      hydrated &&
      hydrated.id === proposal.id &&
      hydrated.version === proposal.version
    )
      return;
    loadProposal(proposal);
    // loadProposal deliberately hydrates only a changed saved revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProposalId, data.proposals, data.businesses, data.runs]);

  function template() {
    if (!lead) return;
    const nextTitle = `Website concept — ${lead.name}`;
    const context = buildContext({
      title: nextTitle,
      business: lead,
      mode: "fact_based",
      evidence: studioEvidenceFrom({ business: lead, runs: data.runs }),
      ai: null,
      lastSavedAt: null,
      version: 0,
    });
    setTitle(nextTitle);
    setSelected(null);
    setMeta(null);
    setMode("fact_based");
    setLastSavedAt(null);
    setVersion(0);
    setError("");
    setPreviewOpen(false);
    setRouteProposalId(null);
    hydratedRef.current = null;
    syncStudioUrl(lead.id, null);
    loadDocument(factBasedConcept(lead), context);
    notify(
      "Fact-based starting draft created. This is a template, not AI output.",
    );
  }

  async function generate(regenerate = false) {
    if (!lead) return;
    setBusy(true);
    setError("");
    try {
      const result = (await action("generate_concept", {
        business_id: lead.id,
        ...(regenerate && meta
          ? { regenerate: true, proposal_id: meta.proposal_id }
          : {}),
      })) as GeneratedConceptResponse;
      const nextTitle = result.title || `Website concept — ${lead.name}`;
      const proposalId = result.proposal?.id || null;
      const nextVersion = result.proposal?.version || 1;
      const nextSavedAt =
        result.proposal?.updated_at ||
        result.proposal?.created_at ||
        result.generated_at ||
        null;
      const nextMeta =
        proposalId && result.provider && result.model
          ? {
              provider: result.provider,
              model: result.model,
              generated_at: result.generated_at,
              version: nextVersion,
              proposal_id: proposalId,
            }
          : null;
      const context = buildContext({
        title: nextTitle,
        business: lead,
        mode: nextMeta ? "ai" : "manual",
        evidence: studioEvidenceFrom({
          business: lead,
          runs: data.runs,
          proposal: result.proposal,
        }),
        ai: nextMeta
          ? {
              provider: nextMeta.provider,
              model: nextMeta.model,
              generated_at: nextMeta.generated_at,
            }
          : null,
        lastSavedAt: nextSavedAt,
        version: nextVersion,
      });
      setTitle(nextTitle);
      setSelected(proposalId);
      setMeta(nextMeta);
      setMode(nextMeta ? "ai" : "manual");
      setLastSavedAt(nextSavedAt);
      setVersion(nextVersion);
      setPreviewOpen(false);
      setRouteProposalId(proposalId);
      hydratedRef.current = proposalId
        ? { id: proposalId, version: nextVersion }
        : null;
      syncStudioUrl(lead.id, proposalId);
      loadDocument(result.content, context);
      notify(
        regenerate
          ? "AI concept regenerated and saved. Review every suggestion before use."
          : "AI concept generated and saved. Review every suggestion before use.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "AI provider is unavailable. No concept was saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(kind: "save" | "version" = "save") {
    if (!lead) return;
    setBusy(true);
    setError("");
    try {
      const saved = (await action("save_proposal", {
        business_id: lead.id,
        title,
        content,
        id: selected || undefined,
        ...(kind === "version" ? { new_version: true } : {}),
      })) as SavedProposalResponse;
      const savedId = saved.id || selected || null;
      const nextVersion =
        typeof saved.version === "number"
          ? saved.version
          : kind === "version"
            ? version + 1
            : version || 1;
      const nextSavedAt =
        saved.updated_at || saved.created_at || new Date().toISOString();
      setSelected(savedId);
      setVersion(nextVersion);
      setLastSavedAt(nextSavedAt);
      setRouteProposalId(savedId);
      hydratedRef.current = savedId
        ? { id: savedId, version: nextVersion }
        : null;
      if (saved.origin === "ai" && saved.ai_provider && saved.ai_model) {
        setMode("ai");
        setMeta((current) => ({
          provider: saved.ai_provider!,
          model: saved.ai_model!,
          generated_at:
            saved.generated_at || current?.generated_at || nextSavedAt,
          version: nextVersion,
          proposal_id: savedId || current?.proposal_id || "",
        }));
      }
      syncStudioUrl(lead.id, savedId || null);
      notify(
        kind === "version"
          ? "New concept version saved to your workspace."
          : "Concept saved to your workspace.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save the concept. No changes were published.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="TURN INSIGHT INTO SOMETHING TANGIBLE"
        title="Website concept studio"
        description="A considered first idea. Personalised to the business. Grounded in what you know."
      >
        <Badge tone="violet">
          <WandSparkles size={13} />
          Concepts, not published websites
        </Badge>
      </PageHeading>
      <div className="studio-layout">
        <aside className="studio-sidebar">
          <Panel
            title="Start with a verified business"
            description="Better facts make better proposals."
          >
            <div className="panel-body form-stack">
              <Field label="Business">
                <select
                  value={leadId}
                  onChange={(e) => resetForLead(e.target.value)}
                >
                  <option value="">Select a business…</option>
                  {data.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.activity_status !== "verified_active"
                        ? " · needs verification"
                        : ""}
                    </option>
                  ))}
                </select>
              </Field>
              {lead && (
                <div className="studio-lead">
                  <div className="business-avatar">
                    {lead.name.slice(0, 2).toUpperCase()}
                  </div>
                  <strong>{lead.name}</strong>
                  <span>
                    {lead.category} · {lead.city}
                  </span>
                  <Badge tone={verified ? "green" : "amber"}>
                    {verified ? "Verified active" : "Review activity first"}
                  </Badge>
                </div>
              )}
              {lead && !verified && (
                <Notice>
                  Record a supported manual activity assessment in the
                  verification centre before creating a proposal.{" "}
                  <Link href={`/leads?lead=${lead.id}`}>Review lead</Link>
                </Notice>
              )}
              {error && (
                <div role="alert">
                  <Notice tone="error">{error}</Notice>
                </div>
              )}
              <Button
                disabled={!verified || busy}
                onClick={template}
                variant="outline"
              >
                <LayoutTemplate size={15} />
                Create fact-based draft
              </Button>
              <Button
                disabled={!verified || busy || !data.config.ai}
                onClick={() => void generate()}
              >
                {busy ? <Spinner /> : <Sparkles size={15} />}Generate with AI
              </Button>
              {meta && (
                <Button
                  disabled={!verified || busy || !data.config.ai}
                  onClick={() => void generate(true)}
                  variant="outline"
                >
                  <RefreshCw size={15} />
                  Regenerate with AI
                </Button>
              )}
              {!data.config.ai && (
                <p className="field-help">
                  AI is optional and currently unconfigured. Use the editable
                  fact-based template at no cost.
                </p>
              )}
            </div>
          </Panel>
          <Panel
            title="Saved proposals"
            action={<span className="muted">{data.proposals.length}</span>}
          >
            {data.proposals.length ? (
              <div className="saved-list">
                {data.proposals.map((p) => (
                  <button
                    key={p.id}
                    className={selected === p.id ? "active" : ""}
                    onClick={() => loadProposal(p)}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>{p.title}</strong>
                      <small>
                        Revision {p.version} ·{" "}
                        {p.origin === "ai" && p.ai_provider
                          ? `AI · ${p.ai_provider} · ${p.ai_model || "model unrecorded"}`
                          : "Manual"}{" "}
                        · Saved{" "}
                        {formatStudioTimestamp(p.updated_at || p.created_at)}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="small-empty">
                <FileText size={22} />
                <p>Your saved ideas will live here.</p>
              </div>
            )}
          </Panel>
        </aside>
        <div className="studio-main">
          {lead && content && (
            <Panel
              title="Concept status"
              description="Saved draft metadata and source provenance. No publishing controls are available."
              className="studio-status-panel"
              action={
                <div className="studio-status-badges">
                  <Badge tone="amber">Draft</Badge>
                  <Badge tone="neutral">Not published</Badge>
                </div>
              }
            >
              <div className="studio-status-body">
                <dl className="studio-status-grid">
                  <div>
                    <dt>Draft status</dt>
                    <dd>
                      <Badge tone="amber">Draft</Badge> Not published
                    </dd>
                  </div>
                  <div>
                    <dt>Source business</dt>
                    <dd>
                      <strong>{lead.name}</strong>
                      <small>
                        {lead.provider} · {lead.source_id}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Last saved time</dt>
                    <dd data-testid="last-saved-time">
                      {formatStudioTimestamp(lastSavedAt)}
                      <small>Revision {version}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>AI provider and model</dt>
                    <dd>
                      {meta
                        ? `${meta.provider} · ${meta.model}`
                        : "Not used — fact-based/manual draft"}
                      {meta && (
                        <small>
                          Generated {formatStudioTimestamp(meta.generated_at)}
                        </small>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="studio-evidence">
                  <h3>Evidence used</h3>
                  <ul>
                    {evidence.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                        <small>
                          {item.observed_at
                            ? `Observed ${formatStudioTimestamp(item.observed_at)}`
                            : "Timestamp not recorded"}
                          {item.url ? ` · ${item.url}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>
          )}
          <Panel
            title={
              content ? "Your website concept" : "A thoughtful starting point"
            }
            description={
              content
                ? "Edit freely. Verify every fact. Keep the business at the centre."
                : "Choose a verified business to shape your first website proposal."
            }
            className="studio-editor"
            action={<Badge tone="neutral">Draft</Badge>}
          >
            {content ? (
              <div className="proposal-editor">
                <Field label="Proposal title">
                  <input
                    value={title}
                    onChange={(e) => changeTitle(e.target.value)}
                    maxLength={180}
                  />
                </Field>
                {meta && (
                  <Notice>
                    <strong>Saved AI concept · revision {meta.version}.</strong>{" "}
                    Provider: {meta.provider} · Model: {meta.model} · Generated:{" "}
                    {formatStudioTimestamp(meta.generated_at)}. This is an
                    editable draft concept, not a built, published, or approved
                    website. Verify uncertain information before use.
                  </Notice>
                )}
                <div className="studio-section-editor">
                  <div className="studio-section-head">
                    <PenLine size={15} />
                    <div>
                      <h3>Editable sections</h3>
                      <p>
                        These fields update the exportable Markdown concept.
                        Human review is required before any use.
                      </p>
                    </div>
                  </div>
                  <div className="studio-section-grid">
                    <Field label="Headline">
                      <input
                        aria-label="Headline"
                        value={sections.headline}
                        onChange={(e) =>
                          updateSection("headline", e.target.value)
                        }
                        maxLength={180}
                      />
                    </Field>
                    <Field label="Call to action">
                      <textarea
                        aria-label="Call to action"
                        value={sections.callToAction}
                        onChange={(e) =>
                          updateSection("callToAction", e.target.value)
                        }
                        maxLength={3000}
                        rows={4}
                      />
                    </Field>
                    <Field label="Services">
                      <textarea
                        aria-label="Services"
                        value={sections.services}
                        onChange={(e) =>
                          updateSection("services", e.target.value)
                        }
                        maxLength={6000}
                        rows={6}
                      />
                    </Field>
                    <Field label="Contact details">
                      <textarea
                        aria-label="Contact details"
                        value={sections.contact}
                        onChange={(e) =>
                          updateSection("contact", e.target.value)
                        }
                        maxLength={3000}
                        rows={5}
                      />
                    </Field>
                    <Field label="Website structure">
                      <textarea
                        aria-label="Website structure"
                        value={sections.structure}
                        onChange={(e) =>
                          updateSection("structure", e.target.value)
                        }
                        maxLength={6000}
                        rows={6}
                      />
                    </Field>
                    <Field label="Visual direction">
                      <textarea
                        aria-label="Visual direction"
                        value={sections.visualDirection}
                        onChange={(e) =>
                          updateSection("visualDirection", e.target.value)
                        }
                        maxLength={6000}
                        rows={6}
                      />
                    </Field>
                    <Field label="Uncertainties / review notes">
                      <textarea
                        aria-label="Uncertainties / review notes"
                        value={sections.uncertainties}
                        onChange={(e) =>
                          updateSection("uncertainties", e.target.value)
                        }
                        maxLength={6000}
                        rows={5}
                      />
                    </Field>
                  </div>
                </div>
                <Field label="Concept & proposal (Markdown)">
                  <textarea
                    className="studio-raw"
                    aria-label="Concept and proposal"
                    value={content}
                    onChange={(e) => {
                      const value = e.target.value;
                      setContent(value);
                      setSections(parseStudioSections(value, documentContext));
                    }}
                    maxLength={30000}
                    rows={18}
                  />
                </Field>
                <div className="editor-footer">
                  <span>
                    <ShieldCheck size={13} />A proposal, not a promise.
                  </span>
                  <Button
                    variant="outline"
                    aria-label="Export"
                    onClick={() =>
                      download("website-concept.md", content, "text/markdown")
                    }
                  >
                    <Download size={15} />
                    Export the concept
                  </Button>
                  <Button
                    variant="outline"
                    aria-label="Create a new version"
                    disabled={
                      busy || !selected || !title.trim() || !content.trim()
                    }
                    onClick={() => void save("version")}
                  >
                    <Layers size={15} />
                    Create a new version
                  </Button>
                  <Button
                    aria-label="Save proposal"
                    disabled={busy || !title.trim() || !content.trim()}
                    onClick={() => void save()}
                  >
                    <Save size={15} />
                    Save the concept
                  </Button>
                </div>
              </div>
            ) : (
              <div className="studio-empty">
                <div className="website-wireframe">
                  <div className="wireframe-top">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="wireframe-nav">
                    <i />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="wireframe-hero">
                    <div>
                      <i />
                      <i />
                      <span />
                      <span />
                      <b />
                    </div>
                    <section>
                      <WandSparkles size={28} />
                    </section>
                  </div>
                  <div className="wireframe-cards">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <h2>Show them what’s possible.</h2>
                <p>
                  Structure, copy, visual direction, and a personalised proposal
                  —
                  <br />
                  one clear concept to start a real conversation.
                </p>
                <div className="studio-features">
                  <span>
                    <LayoutTemplate size={15} />
                    Clear structure
                  </span>
                  <span>
                    <PenLine size={15} />
                    Editable copy
                  </span>
                  <span>
                    <MonitorSmartphone size={15} />
                    Mobile-first thinking
                  </span>
                </div>
              </div>
            )}
          </Panel>
          {content && (
            <Panel
              title="Layout preview"
              description="Concept-only rendering. No website is created, deployed, or published."
              className="studio-preview-panel"
              action={<Badge tone="neutral">Not published</Badge>}
            >
              <div className="studio-preview-controls">
                <Button
                  variant={
                    previewOpen && previewMode === "desktop"
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={previewOpen && previewMode === "desktop"}
                  onClick={() => {
                    setPreviewMode("desktop");
                    setPreviewOpen(true);
                  }}
                >
                  <Monitor size={15} />
                  Preview desktop layout
                </Button>
                <Button
                  variant={
                    previewOpen && previewMode === "mobile"
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={previewOpen && previewMode === "mobile"}
                  onClick={() => {
                    setPreviewMode("mobile");
                    setPreviewOpen(true);
                  }}
                >
                  <Smartphone size={15} />
                  Preview mobile layout
                </Button>
              </div>
              {previewOpen ? (
                <div className={`studio-preview-frame ${previewMode}`}>
                  <div
                    className={`studio-preview ${previewMode}`}
                    role="region"
                    aria-label={
                      previewMode === "desktop"
                        ? "Desktop layout preview"
                        : "Mobile layout preview"
                    }
                  >
                    <div className="studio-preview-chrome">
                      <span />
                      <span />
                      <span />
                      <small>Concept-only preview · Not published</small>
                    </div>
                    <div className="studio-preview-page">
                      <header>
                        <strong>{lead?.name || "Verified business"}</strong>
                        <nav aria-label="Preview navigation">
                          <span>Home</span>
                          <span>Services</span>
                          <span>Contact</span>
                        </nav>
                      </header>
                      <section className="studio-preview-hero">
                        <div>
                          <small>Concept headline</small>
                          <h3>{sections.headline}</h3>
                          <p>{sections.services}</p>
                          <span className="studio-preview-cta">
                            {sections.callToAction}
                          </span>
                        </div>
                        <aside>
                          <small>Visual direction</small>
                          <p>{sections.visualDirection}</p>
                        </aside>
                      </section>
                      <section className="studio-preview-cards">
                        <article>
                          <small>Contact details</small>
                          <p>{sections.contact}</p>
                        </article>
                        <article>
                          <small>Website structure</small>
                          <p>{sections.structure}</p>
                        </article>
                        <article>
                          <small>Uncertain information</small>
                          <p>{sections.uncertainties}</p>
                        </article>
                      </section>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="studio-preview-prompt">
                  <Eye size={20} />
                  <p>
                    Choose desktop or mobile to inspect the editable concept
                    layout. This preview is not a published website.
                  </p>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
