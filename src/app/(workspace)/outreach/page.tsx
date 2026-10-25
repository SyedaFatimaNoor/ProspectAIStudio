"use client";
import { useState } from "react";
import {
  Send,
  Mail,
  MessageCircle,
  Plus,
  ShieldCheck,
  Save,
  Eye,
  Ban,
  ArrowRight,
  FileText,
  CheckCircle2,
  AlertCircle,
  Download,
  StickyNote,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  PageHeading,
  Panel,
  Field,
  Notice,
  Badge,
  EmptyState,
  Spinner,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { download, formatDate } from "@/lib/utils";
import type { Message } from "@/lib/types";
export default function Outreach() {
  const { data, action, notify } = useWorkspace();
  const [tab, setTab] = useState("drafts");
  const [edit, setEdit] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    id: "",
    business_id: "",
    channel: "email",
    recipient: "",
    subject: "",
    body: "",
    lawful_basis: "",
  });
  const [basis, setBasis] = useState("");
  const [approval, setApproval] = useState(false);
  const [messageNote, setMessageNote] = useState("");
  const [eventType, setEventType] = useState("note");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  function snapshot(f: typeof form) {
    return JSON.stringify([
      f.business_id,
      f.channel,
      f.recipient,
      f.subject,
      f.body,
    ]);
  }
  const lead = data.businesses.find((b) => b.id === form.business_id);
  function newDraft() {
    setForm({
      id: "",
      business_id: "",
      channel: "email",
      recipient: "",
      subject: "",
      body: "",
      lawful_basis: "",
    });
    setEdit(true);
    setPreview(false);
    setApproval(false);
    setBasis("");
    setSavedSnapshot("");
  }
  function open(m: Message) {
    setForm({ ...m });
    setBasis(m.lawful_basis);
    setSavedSnapshot(snapshot(m));
    setEdit(true);
    setPreview(false);
    setApproval(false);
  }
  function pickLead(id: string) {
    const b = data.businesses.find((b) => b.id === id);
    setForm((f) => ({
      ...f,
      business_id: id,
      recipient: f.channel === "email" ? b?.email || "" : b?.phone || "",
      subject: `A website idea for ${b?.name || "your business"}`,
      body: `Hello ${b?.name || "there"} team,\n\nI came across your public listing in ${b?.city || "your area"} and wanted to ask about your current online presence. Would a short conversation about a website concept be useful?\n\nThis is an initial idea, not a built or approved website.\n\n[Add your full name, business identity, and required contact/postal details before approval.]\n\nIf you prefer not to hear from me, please reply and I won’t contact you again.`,
    }));
  }
  async function save() {
    setBusy(true);
    try {
      const result = (await action("save_message", {
        ...form,
        id: form.id || undefined,
      })) as { id: string };
      setForm((f) => ({ ...f, id: result.id }));
      setSavedSnapshot(snapshot(form));
      notify("Outreach draft saved. Nothing has been sent.");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    setBusy(true);
    try {
      await action("approve_message", { id: form.id, lawful_basis: basis });
      notify("Draft approved for review. Sending remains disabled.");
      setPreview(false);
      setEdit(false);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function suppress(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await action("suppress", { contact, reason });
      notify("Opt-out recorded. Existing matching drafts are now suppressed.");
      setContact("");
      setReason("");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const filtered = data.messages.filter((m) =>
    tab === "approved"
      ? m.status === "approved"
      : tab === "sent"
        ? m.status === "sent"
        : ["draft", "suppressed", "failed"].includes(m.status),
  );
  return (
    <>
      <PageHeading
        eyebrow="MAKE THE FIRST HELLO COUNT"
        title="Outreach centre"
        description="Thoughtful messages, a human review, and respect for every recipient."
      >
        <Badge tone="amber">Draft-only mode</Badge>
        <Button onClick={newDraft}>
          <Plus size={16} />
          New draft
        </Button>
      </PageHeading>
      <Notice>
        Sending is disabled. Prepare and approve individual drafts here; use an
        authorised provider only after legal and platform-policy review. Public
        contact details do not imply consent.
      </Notice>
      <div className="outreach-stats">
        {[
          [
            "Drafts",
            data.messages.filter((m) => m.status === "draft").length,
            FileText,
          ],
          [
            "Approved for review",
            data.messages.filter((m) => m.status === "approved").length,
            CheckCircle2,
          ],
          [
            "Messages sent",
            data.messages.filter((m) => m.status === "sent").length,
            Send,
          ],
          ["Suppressed contacts", data.suppressions.length, Ban],
        ].map(([label, value, Icon]) => {
          const I = Icon as typeof Mail;
          return (
            <div key={String(label)}>
              <I size={19} />
              <strong>{Number(value)}</strong>
              <span>{String(label)}</span>
            </div>
          );
        })}
      </div>
      <div className="outreach-layout">
        <Panel
          title="Your conversations start here"
          description="Personalised, reviewed, and never sent automatically."
        >
          <div className="tabs padded-tabs">
            {[
              ["drafts", "Drafts"],
              ["approved", "Approved"],
              ["sent", "Sent"],
              ["suppression", "Suppression list"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={tab === v ? "active" : ""}
                onClick={() => setTab(v)}
              >
                {l}
              </button>
            ))}
          </div>
          {tab === "suppression" ? (
            <div className="panel-body">
              <form className="form-stack" onSubmit={suppress}>
                <Field
                  label="Contact to suppress"
                  hint="Enter the exact email address or internationally formatted phone number."
                >
                  <input
                    required
                    maxLength={200}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="business@example.com or +923…"
                  />
                </Field>
                <Field label="Opt-out reason">
                  <input
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Recipient requested no further contact"
                  />
                </Field>
                <Button disabled={busy} type="submit">
                  <Ban size={15} />
                  Record opt-out
                </Button>
              </form>
              <div className="suppression-list">
                {data.suppressions.map((s) => (
                  <div key={s.id}>
                    <Ban size={16} />
                    <span>
                      <strong>{s.contact}</strong>
                      <small>{s.reason}</small>
                    </span>
                    <Badge tone="red">Do not contact</Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : !filtered.length ? (
            <EmptyState
              icon={tab === "sent" ? Send : Mail}
              title={
                tab === "sent"
                  ? "No messages have been sent"
                  : "Good outreach begins with a good draft"
              }
              description={
                tab === "sent"
                  ? "This workspace is intentionally draft-only. No provider is authorised to send messages."
                  : "Choose a business, personalise your message, and review it before any outreach."
              }
            />
          ) : (
            <div className="message-list">
              {filtered.map((m) => (
                <button onClick={() => open(m)} key={m.id}>
                  <span
                    className={`message-channel ${m.channel === "whatsapp" ? "green" : "blue"}`}
                  >
                    {m.channel === "email" ? (
                      <Mail size={18} />
                    ) : (
                      <MessageCircle size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{m.subject || `Message to ${m.recipient}`}</strong>
                    <small>
                      {m.recipient} · {formatDate(m.created_at)}
                    </small>
                  </span>
                  <Badge
                    tone={
                      m.status === "suppressed"
                        ? "red"
                        : m.status === "approved"
                          ? "green"
                          : "neutral"
                    }
                  >
                    {m.status}
                  </Badge>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          )}
        </Panel>
        <aside>
          <div className="outreach-note">
            <span className="outreach-note-icon">
              <Send size={25} />
            </span>
            <h2>
              Fewer messages.
              <br />
              Better conversations.
            </h2>
            <p>
              Be relevant. Be transparent. Give people an easy way to say “no,
              thanks.”
            </p>
            <ul>
              <li>
                <ShieldCheck size={15} />
                Document a lawful basis
              </li>
              <li>
                <Eye size={15} />
                Review every message
              </li>
              <li>
                <Ban size={15} />
                Honour every opt-out
              </li>
            </ul>
          </div>
          <Panel title="Messaging integrations">
            <div className="integration-mini">
              <Mail size={19} />
              <span>
                Email provider<small>Not configured</small>
              </span>
              <Badge>Draft only</Badge>
            </div>
            <div className="integration-mini">
              <MessageCircle size={19} />
              <span>
                WhatsApp Business<small>Not configured</small>
              </span>
              <Badge>Draft only</Badge>
            </div>
          </Panel>
        </aside>
      </div>
      <Dialog
        open={edit}
        onOpenChange={setEdit}
        title={
          preview
            ? "Review before approval"
            : "Create a thoughtful introduction"
        }
        description="Nothing will be sent. This workspace supports drafts and review only."
        wide
      >
        {preview ? (
          <div className="panel-body form-stack">
            <div className="message-preview">
              <div>
                <strong>To:</strong> {form.recipient}
              </div>
              <div>
                <strong>Subject:</strong> {form.subject}
              </div>
              <p>{form.body}</p>
            </div>
            <Field
              label="Document your lawful basis"
              hint="Explain consent or another applicable legal basis. Review local laws and platform policies."
            >
              <textarea
                rows={3}
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={approval}
                onChange={(e) => setApproval(e.target.checked)}
              />
              <span>
                I have reviewed the recipient, factual claims, contact source,
                identity, and opt-out information.
              </span>
            </label>
            <Notice>
              Approval does not send the message. Email and WhatsApp sending
              adapters are not enabled in this release.
            </Notice>
            <div className="editor-footer">
              <Button variant="outline" onClick={() => setPreview(false)}>
                Back to editor
              </Button>
              <Button
                disabled={!approval || basis.trim().length < 10 || busy}
                onClick={() => void approve()}
              >
                <CheckCircle2 size={15} />
                Approve draft
              </Button>
            </div>
          </div>
        ) : (
          <div className="panel-body form-stack">
            <div className="form-grid">
              <Field label="Business">
                <select
                  required
                  value={form.business_id}
                  onChange={(e) => pickLead(e.target.value)}
                >
                  <option value="">Select a business…</option>
                  {data.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel">
                <select
                  value={form.channel}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      channel: e.target.value,
                      recipient:
                        e.target.value === "email"
                          ? lead?.email || ""
                          : lead?.phone || "",
                    }))
                  }
                >
                  <option value="email">Email draft</option>
                  <option value="whatsapp">WhatsApp Business draft</option>
                </select>
              </Field>
            </div>
            <Field
              label="Recipient"
              hint={
                lead
                  ? `Source: ${lead.provider} · ${lead.source_url || "review lead details"}`
                  : "Choose a business to view contact provenance."
              }
            >
              <input
                value={form.recipient}
                onChange={(e) =>
                  setForm((f) => ({ ...f, recipient: e.target.value }))
                }
                maxLength={200}
                placeholder={
                  form.channel === "email"
                    ? "public-contact@example.com"
                    : "+923…"
                }
              />
            </Field>
            <Field label="Subject">
              <input
                value={form.subject}
                maxLength={200}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
              />
            </Field>
            <Field label="Your message">
              <textarea
                rows={10}
                maxLength={10000}
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
              />
            </Field>
            <div className="personalisation-hint">
              <span>Insert:</span>
              {[
                ["Business name", lead?.name],
                ["City", lead?.city],
                ["Category", lead?.category],
              ].map(([l, v]) => (
                <button
                  key={l}
                  disabled={!v}
                  onClick={() =>
                    setForm((f) => ({ ...f, body: f.body + ` ${v}` }))
                  }
                >
                  {l} +
                </button>
              ))}
            </div>
            {form.id && (
              <div className="form-grid">
                <Field label="Conversation note type">
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                  >
                    <option value="note">Research note</option>
                    <option value="reply">
                      Reply received (manually recorded)
                    </option>
                    <option value="follow_up">Follow-up status</option>
                  </select>
                </Field>
                <Field label="Reply or follow-up note">
                  <input
                    value={messageNote}
                    onChange={(e) => setMessageNote(e.target.value)}
                    placeholder="Record a reply or next step…"
                    maxLength={2000}
                  />
                </Field>
                <Button
                  variant="outline"
                  className="self-end"
                  disabled={!messageNote.trim()}
                  onClick={async () => {
                    try {
                      await action("message_event", {
                        message_id: form.id,
                        detail: messageNote,
                        event_type: eventType,
                      });
                      notify("Conversation note recorded.");
                      setMessageNote("");
                    } catch {}
                  }}
                >
                  <StickyNote size={15} />
                  Save note
                </Button>
              </div>
            )}
            {form.id && (
              <div className="conversation-history">
                {data.events
                  .filter((e) => e.message_id === form.id)
                  .map((e, i) => (
                    <div key={i}>
                      <Badge>{e.event_type.replaceAll("_", " ")}</Badge>
                      <p>{e.detail}</p>
                    </div>
                  ))}
              </div>
            )}
            {form.id && savedSnapshot !== snapshot(form) && (
              <p className="field-help">
                Save your changes before reviewing this draft. Approval applies
                only to the saved version.
              </p>
            )}
            <div className="editor-footer">
              <Button
                variant="outline"
                disabled={!form.body}
                onClick={() =>
                  download(
                    "outreach-draft.txt",
                    `To: ${form.recipient}\nSubject: ${form.subject}\n\n${form.body}`,
                  )
                }
              >
                <Download size={15} />
                Export draft
              </Button>
              <Button
                variant="outline"
                disabled={
                  !form.business_id || !form.recipient || !form.body || busy
                }
                onClick={() => void save()}
              >
                <Save size={15} />
                Save draft
              </Button>
              <Button
                disabled={!form.id || busy || savedSnapshot !== snapshot(form)}
                onClick={() => setPreview(true)}
              >
                <Eye size={15} />
                Review & approve
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
