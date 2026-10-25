"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MapPin,
  ExternalLink,
  Globe2,
  Phone,
  Mail,
  ShieldCheck,
  Clock3,
  FileText,
  Trash2,
  ArrowRight,
  Save,
  History,
  Link2,
} from "lucide-react";
import type { Business } from "@/lib/types";
import { useWorkspace } from "./workspace-provider";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge, Notice, Spinner, Field } from "./shared";
import { formatDate } from "@/lib/utils";
export function LeadDetail({
  lead,
  onClose,
}: {
  lead: Business | null;
  onClose: () => void;
}) {
  const { data, action, notify } = useWorkspace();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("evidence");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manual, setManual] = useState({
    activity: "verified_active",
    website: "manual_review",
    explanation: "",
    source_url: "",
    second_source: "",
    observed_at: new Date().toISOString().slice(0, 10),
  });
  useEffect(() => {
    setNotes(lead?.notes || "");
    setTab("evidence");
    setConfirmDelete(false);
  }, [lead?.id, lead?.notes]);
  if (!lead) return null;
  const runs = data.runs.filter((r) => r.business_id === lead.id);
  async function run(
    type: string,
    payload: Record<string, unknown>,
    message: string,
  ) {
    setBusy(true);
    try {
      await action(type, payload);
      notify(message);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={!!lead}
      onOpenChange={(v) => !v && onClose()}
      title={lead.name}
      description={`${lead.category.replaceAll("_", " ")} · ${lead.city}, ${lead.country}`}
      wide
    >
      <div className="lead-detail-header">
        <div className="business-initial">
          {lead.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <Badge
            tone={
              lead.activity_status === "verified_active" ? "green" : "amber"
            }
          >
            {lead.verification_status}
          </Badge>
          <p>
            Discovered {formatDate(lead.created_at)} · {lead.provider}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(
              "verify",
              { business_id: lead.id },
              "Verification queued. Review the new evidence after the worker completes it.",
            )
          }
        >
          <ShieldCheck size={15} />
          Verify evidence
        </Button>
      </div>
      <div className="confidence-grid">
        <div>
          <span>Business activity</span>
          <strong>{lead.activity_status.replaceAll("_", " ")}</strong>
          <div className="confidence-track">
            <span style={{ width: `${lead.activity_confidence}%` }} />
          </div>
          <small>
            {lead.activity_confidence}% confidence · evidence-based, not a
            guarantee
          </small>
        </div>
        <div>
          <span>Official website</span>
          <strong>{lead.website_status.replaceAll("_", " ")}</strong>
          <div className="confidence-track violet-track">
            <span style={{ width: `${lead.website_confidence}%` }} />
          </div>
          <small>
            {lead.website_confidence}% confidence · independent assessment
          </small>
        </div>
      </div>
      <div className="tabs">
        {["evidence", "contact", "notes", "assessment"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "evidence"
              ? "Evidence & history"
              : t === "contact"
                ? "Contact & provenance"
                : t === "assessment"
                  ? "Record assessment"
                  : "Notes"}
          </button>
        ))}
      </div>
      {tab === "evidence" && (
        <div className="detail-body">
          <Notice>
            A listing without a website link is not proof that a business has no
            official website. Confirm recent activity before outreach.
          </Notice>
          <h3 className="section-small-title">Source record</h3>
          {lead.source_url && (
            <a
              href={lead.source_url}
              target="_blank"
              rel="noreferrer"
              className="evidence-source"
            >
              <span className="source-logo">
                <Globe2 size={20} />
              </span>
              <span>
                <strong>{lead.provider}</strong>
                <small>
                  {lead.source_id} · observed {formatDate(lead.created_at)}
                </small>
              </span>
              <ExternalLink size={16} />
            </a>
          )}
          <h3 className="section-small-title">
            Verification history <span>{runs.length} runs</span>
          </h3>
          {!runs.length ? (
            <div className="small-empty">
              <History size={22} />
              <p>
                No verification yet. Queue a review to create a timestamped
                evidence trail.
              </p>
            </div>
          ) : (
            runs.map((r) => (
              <div className="evidence-run" key={r.id}>
                <div>
                  <Badge tone={r.status === "completed" ? "green" : "amber"}>
                    {r.status}
                  </Badge>
                  <small>{formatDate(r.created_at)}</small>
                </div>
                <p>
                  {r.explanation ||
                    r.error ||
                    "Waiting for the verification worker."}
                </p>
                {r.evidence.map((ev, i) => (
                  <div className="evidence-item" key={i}>
                    <ShieldCheck size={16} />
                    <div>
                      <strong>{ev.type}</strong>
                      <p>{ev.detail}</p>
                      {ev.url && (
                        <a href={ev.url} target="_blank" rel="noreferrer">
                          View source <ExternalLink size={11} />
                        </a>
                      )}
                      <small>{new Date(ev.timestamp).toLocaleString()}</small>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
      {tab === "contact" && (
        <div className="detail-body">
          <Notice>
            Only public business contacts are stored. The source listing is
            provenance, not consent to receive marketing.
          </Notice>
          <dl className="contact-list">
            {[
              [Phone, "Phone", lead.phone],
              [Mail, "Email", lead.email],
              [Globe2, "Website candidate", lead.website],
              [MapPin, "Location", `${lead.city}, ${lead.country}`],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof Phone;
              return (
                <div key={String(label)}>
                  <dt>
                    <I size={16} />
                    {String(label)}
                  </dt>
                  <dd>{String(value || "Not supplied by source")}</dd>
                </div>
              );
            })}
          </dl>
          <h3 className="section-small-title">Contact provenance</h3>
          <p className="muted">
            Publicly listed on {lead.provider}; collected{" "}
            {formatDate(lead.created_at)}. Contact ownership, currency, and
            lawful basis must be reviewed before use.
          </p>
          {lead.source_url && (
            <a
              className="text-link"
              href={lead.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Review original listing <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}
      {tab === "notes" && (
        <div className="detail-body">
          <label className="field">
            <span>Research notes</span>
            <textarea
              rows={7}
              maxLength={10000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Capture context, questions, or your manual review findings…"
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                "save_notes",
                { id: lead.id, notes },
                "Research notes saved.",
              )
            }
          >
            <Save size={14} />
            Save notes
          </Button>
        </div>
      )}
      {tab === "assessment" && (
        <form
          className="detail-body form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(
              "manual_review",
              {
                ...manual,
                business_id: lead.id,
                second_source: manual.second_source || undefined,
              },
              "Manual assessment and its evidence saved. Confidence scores are reviewer-attested, not automated proof.",
            );
          }}
        >
          <Notice>
            Record only evidence you actually reviewed. Reviewer-attested active
            or website assessments score 85/100 by rubric, not as a guarantee.
            High-confidence absence requires two independent sources and a
            documented search scope.
          </Notice>
          <div className="form-grid">
            <Field label="Business activity">
              <select
                value={manual.activity}
                onChange={(e) =>
                  setManual((m) => ({ ...m, activity: e.target.value }))
                }
              >
                <option value="verified_active">
                  Verified active — recent evidence reviewed
                </option>
                <option value="manual_review">
                  Uncertain — manual review required
                </option>
                <option value="closed_inactive">
                  Closed or inactive evidence
                </option>
              </select>
            </Field>
            <Field label="Official website assessment">
              <select
                value={manual.website}
                onChange={(e) =>
                  setManual((m) => ({ ...m, website: e.target.value }))
                }
              >
                <option value="manual_review">
                  Uncertain — manual review required
                </option>
                <option value="website_found">
                  Official website found and identity confirmed
                </option>
                <option value="no_website_high_confidence">
                  No website found — high confidence
                </option>
              </select>
            </Field>
          </div>
          <Field label="Primary evidence URL">
            <input
              required
              type="url"
              value={manual.source_url}
              onChange={(e) =>
                setManual((m) => ({ ...m, source_url: e.target.value }))
              }
              placeholder="https://…"
            />
          </Field>
          <Field
            label="Independent corroborating source URL"
            hint="Required for high-confidence website absence. Must be a different source host."
          >
            <input
              type="url"
              required={manual.website === "no_website_high_confidence"}
              value={manual.second_source}
              onChange={(e) =>
                setManual((m) => ({ ...m, second_source: e.target.value }))
              }
              placeholder="https://…"
            />
          </Field>
          <Field label="Evidence observation date">
            <input
              required
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={manual.observed_at}
              onChange={(e) =>
                setManual((m) => ({ ...m, observed_at: e.target.value }))
              }
            />
          </Field>
          <Field
            label="Evidence, reasoning, and research scope"
            hint="Describe recent activity, identity consistency, sources searched, uncertainty, and why each conclusion is supported."
          >
            <textarea
              required
              minLength={40}
              maxLength={3000}
              rows={5}
              value={manual.explanation}
              onChange={(e) =>
                setManual((m) => ({ ...m, explanation: e.target.value }))
              }
            />
          </Field>
          <Button type="submit" disabled={busy}>
            <ShieldCheck size={15} />
            Save evidence-based assessment
          </Button>
        </form>
      )}
      <div className="dialog-footer">
        <div>
          {confirmDelete ? (
            <>
              <span className="delete-confirm">
                Delete this lead and associated data?
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  await run(
                    "delete_leads",
                    { ids: [lead.id] },
                    "Lead and associated records deleted.",
                  );
                  onClose();
                }}
              >
                Confirm delete
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              Delete lead
            </Button>
          )}
        </div>
        <Button variant="outline" asChild>
          <Link href={`/studio?lead=${lead.id}`}>
            <FileText size={15} />
            Create proposal
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
    </Dialog>
  );
}
