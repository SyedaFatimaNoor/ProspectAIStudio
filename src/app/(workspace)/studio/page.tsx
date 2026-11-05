"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  WandSparkles,
  FileText,
  Save,
  Download,
  ArrowRight,
  Sparkles,
  LayoutTemplate,
  ShieldCheck,
  ChevronRight,
  PenLine,
  History,
  MonitorSmartphone,
  RefreshCw,
} from "lucide-react";
import {
  PageHeading,
  Panel,
  Field,
  Notice,
  Badge,
  Spinner,
  EmptyState,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { factBasedConcept } from "@/lib/proposal";
import { download, formatDate } from "@/lib/utils";
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

export default function Studio() {
  const { data, action, notify } = useWorkspace();
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [meta, setMeta] = useState<ConceptMeta | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setLeadId(new URLSearchParams(window.location.search).get("lead") || "");
  }, []);
  const lead = data.businesses.find((b) => b.id === leadId);
  const verified = lead?.activity_status === "verified_active";
  function template() {
    if (!lead) return;
    setTitle(`Website concept — ${lead.name}`);
    setContent(factBasedConcept(lead));
    setSelected(null);
    setMeta(null);
    setError("");
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
      setContent(result.content);
      setTitle(result.title || `Website concept — ${lead.name}`);
      setSelected(result.proposal?.id || null);
      if (result.proposal && result.provider && result.model) {
        setMeta({
          provider: result.provider,
          model: result.model,
          generated_at: result.generated_at,
          version: result.proposal.version,
          proposal_id: result.proposal.id,
        });
      }
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
  async function save() {
    if (!lead) return;
    setBusy(true);
    try {
      const saved = (await action("save_proposal", {
        business_id: lead.id,
        title,
        content,
        id: selected || undefined,
      })) as { id?: string; version?: number };
      if (saved.id) {
        setSelected(saved.id);
        setMeta((current) =>
          current
            ? {
                ...current,
                proposal_id: saved.id!,
                version: saved.version ?? current.version,
              }
            : current,
        );
      }
      notify("Proposal saved to your workspace.");
    } catch {
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
                  onChange={(e) => {
                    setLeadId(e.target.value);
                    setSelected(null);
                    setContent("");
                    setTitle("");
                    setMeta(null);
                    setError("");
                  }}
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
                    onClick={() => {
                      setSelected(p.id);
                      setLeadId(p.business_id);
                      setTitle(p.title);
                      setContent(p.content);
                      setError("");
                      setMeta(
                        p.origin === "ai" &&
                          p.ai_provider &&
                          p.ai_model &&
                          p.generated_at
                          ? {
                              provider: p.ai_provider,
                              model: p.ai_model,
                              generated_at: p.generated_at,
                              version: p.version,
                              proposal_id: p.id,
                            }
                          : null,
                      );
                    }}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>{p.title}</strong>
                      <small>
                        Revision {p.version} ·{" "}
                        {p.origin === "ai" && p.ai_provider
                          ? `AI · ${p.ai_provider} · ${p.ai_model || "model unrecorded"}`
                          : "Manual"}{" "}
                        · {formatDate(p.generated_at || p.created_at)}
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
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={180}
                />
              </Field>
              {meta && (
                <Notice>
                  <strong>Saved AI concept · revision {meta.version}.</strong>{" "}
                  Provider: {meta.provider} · Model: {meta.model} · Generated:{" "}
                  {new Date(meta.generated_at).toLocaleString()}. This is an
                  editable draft concept, not a built, published, or approved
                  website. Verify uncertain information before use.
                </Notice>
              )}
              <Field label="Concept & proposal (Markdown)">
                <textarea
                  aria-label="Concept and proposal"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={30000}
                  rows={27}
                />
              </Field>
              <div className="editor-footer">
                <span>
                  <ShieldCheck size={13} />A proposal, not a promise.
                </span>
                <Button
                  variant="outline"
                  onClick={() =>
                    download("website-concept.md", content, "text/markdown")
                  }
                >
                  <Download size={15} />
                  Export
                </Button>
                <Button
                  disabled={busy || !title.trim() || !content.trim()}
                  onClick={() => void save()}
                >
                  <Save size={15} />
                  Save proposal
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
                Structure, copy, visual direction, and a personalised proposal —
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
      </div>
    </>
  );
}
