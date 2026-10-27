"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Compass,
  MapPin,
  Globe2,
  ArrowRight,
  ShieldCheck,
  Play,
  Pause,
  Square,
  RefreshCw,
  CheckCircle2,
  Info,
  Terminal,
  ExternalLink,
  Layers3,
  Clock3,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  PageHeading,
  Panel,
  Field,
  Notice,
  Badge,
  Spinner,
  EmptyState,
} from "@/components/shared";
import { formatDate } from "@/lib/utils";
import {
  discoveryResultLimit,
  validateDiscoveryForm,
  discoveryBlockReason,
  discoveryJobErrorMessage,
} from "@/lib/discovery-form";
import { workerIsKnownPaused } from "@/lib/cloud-worker";
export default function Discovery() {
  const { data, loading, connectionError, action, notify, refresh } =
    useWorkspace();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    country: "Pakistan",
    city: "",
    category: "cafe",
    keywords: "",
    service_area: "",
    max_results: "25",
    requirements: { public_contact: false, website_review: true },
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [limitEdited, setLimitEdited] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const limit = discoveryResultLimit(data.settings?.search_limit);
  useEffect(() => {
    if (!limitEdited)
      setForm((f) => ({ ...f, max_results: String(Math.min(25, limit)) }));
  }, [limit, limitEdited]);
  const validation = validateDiscoveryForm(
    {
      ...form,
      max_results:
        form.max_results.trim() === "" ? NaN : Number(form.max_results),
    },
    limit,
  );
  const errors = attempted ? validation.errors : {};
  const blockedReason = discoveryBlockReason(data, loading, connectionError);
  const workerPaused = workerIsKnownPaused(data.config.worker);
  const set = (key: string, value: unknown) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSubmissionError(null);
    setSuccess(null);
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setAttempted(true);
    setSuccess(null);
    setSubmissionError(null);
    if (!validation.success) {
      const formElement = e.currentTarget;
      // Wait for aria-invalid/descriptions to commit, then focus in visual DOM
      // order (not schema order), so assistive technology reads the new error.
      requestAnimationFrame(() => {
        if (!formElement.isConnected) return;
        const field = Array.from(formElement.elements).find(
          (control) =>
            (control instanceof HTMLInputElement ||
              control instanceof HTMLSelectElement) &&
            Boolean(validation.errors[control.name]),
        );
        if (field instanceof HTMLElement) field.focus();
      });
      return;
    }
    if (blockedReason) {
      setSubmissionError(blockedReason);
      notify(blockedReason, true);
      return;
    }
    setBusy(true);
    try {
      await action("create_job", validation.data);
      setSuccess(
        "Discovery queued. Queued is not a completed search—follow the job logs for source results, progress and provider errors.",
      );
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : "Unable to queue discovery. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function control(id: string, status: string) {
    try {
      await action("update_job", { id, status });
      notify(`Job ${status}.`);
    } catch {}
  }
  return (
    <>
      <PageHeading
        eyebrow="FIND YOUR NEXT OPPORTUNITY"
        title="Discover businesses"
        description="Start with a place and a purpose. We’ll help you find the possibilities."
      >
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Refresh jobs
        </Button>
      </PageHeading>
      {workerPaused && (
        <Notice tone="error">
          Cloud discovery is paused, so new searches are blocked. The operator
          must resolve the provider/setup issue before re-enabling the
          scheduler. Existing queued jobs are shown as blocked below; no source
          results are fabricated.{" "}
          <Link href="/settings">View setup instructions</Link>.
        </Notice>
      )}
      {data.config.worker?.enabled && (
        <Notice>
          Cloud discovery is enabled: one job attempt every{" "}
          {data.config.worker.interval_minutes} minutes when work is due. Today:{" "}
          {data.config.worker.daily_attempts}/{data.config.worker.daily_limit}{" "}
          attempts (UTC).
          {data.config.worker.daily_attempts >= data.config.worker.daily_limit
            ? " Daily cap reached; queued jobs wait until the next UTC day."
            : " Queued jobs do not need a laptop worker."}{" "}
          Cloud evidence review is listing-only; activity and website
          ownership/absence require manual review.
        </Notice>
      )}
      <div className="discovery-layout">
        <Panel
          title="A little direction goes a long way"
          description="Define the businesses you’d like to discover."
          className="discovery-form-panel"
        >
          <form
            onSubmit={submit}
            className="form-stack"
            noValidate
            aria-busy={busy}
          >
            {attempted && !validation.success && (
              <div className="form-feedback form-feedback-error" role="alert">
                Please check the highlighted fields before starting discovery.
              </div>
            )}
            {submissionError && (
              <div className="form-feedback form-feedback-error" role="alert">
                {submissionError}
              </div>
            )}
            {success && (
              <div
                className="form-feedback form-feedback-success"
                role="status"
              >
                {success}
              </div>
            )}
            <div className="form-section-title">
              <MapPin size={17} />
              Where are we looking?<span>01</span>
            </div>
            <div className="form-grid">
              <Field label="Country" error={errors.country}>
                <input
                  required
                  name="country"
                  value={form.country}
                  maxLength={80}
                  onChange={(e) => set("country", e.target.value)}
                  placeholder="e.g. Pakistan"
                />
              </Field>
              <Field label="City" error={errors.city}>
                <input
                  required
                  name="city"
                  value={form.city}
                  maxLength={100}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="e.g. Karachi"
                />
              </Field>
            </div>
            <Field
              label="Service area (optional)"
              hint="Context for your research. The source query uses city boundaries."
              error={errors.service_area}
            >
              <input
                name="service_area"
                value={form.service_area}
                onChange={(e) => set("service_area", e.target.value)}
                placeholder="e.g. Clifton, DHA, and surrounding areas"
                maxLength={150}
              />
            </Field>
            <div className="form-section-title">
              <Layers3 size={17} />
              Which businesses fit your focus?<span>02</span>
            </div>
            <div className="form-grid">
              <Field label="Business category" error={errors.category}>
                <select
                  name="category"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {[
                    ["cafe", "Cafés & coffee shops"],
                    ["restaurant", "Restaurants"],
                    ["dentist", "Dental clinics"],
                    ["hairdresser", "Hair salons"],
                    ["bakery", "Bakeries"],
                    ["car_repair", "Auto repair"],
                    ["florist", "Florists"],
                    ["gym", "Gyms & fitness"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Maximum results"
                hint={`Up to ${limit} public listings per job (workspace limit).`}
                error={errors.max_results}
              >
                <input
                  type="number"
                  min={1}
                  max={limit}
                  step={1}
                  required
                  name="max_results"
                  value={form.max_results}
                  onChange={(e) => {
                    setLimitEdited(true);
                    set("max_results", e.target.value);
                  }}
                />
              </Field>
            </div>
            <Field
              label="Keywords (optional)"
              hint="Filters business names returned by the source."
              error={errors.keywords}
            >
              <input
                name="keywords"
                value={form.keywords}
                maxLength={120}
                onChange={(e) => set("keywords", e.target.value)}
                placeholder="e.g. specialty, independent, family"
              />
            </Field>
            <div className="form-section-title">
              <Globe2 size={17} />
              Choose a trusted starting point<span>03</span>
            </div>
            <label className="source-option">
              <input type="checkbox" checked readOnly />
              <span className="source-logo">
                <Globe2 size={22} />
              </span>
              <span>
                <strong>OpenStreetMap</strong>
                <small>
                  Community-maintained public business listings · ODbL
                </small>
              </span>
              <Badge
                tone={!data.config.discovery || workerPaused ? "amber" : "blue"}
              >
                {!data.config.discovery
                  ? "Setup needed"
                  : workerPaused
                    ? "Worker paused"
                    : "Source configured"}
              </Badge>
            </label>
            <p className="field-help">
              A public listing is a starting point, not proof of current
              activity. Source attribution and timestamps are retained.
              {data.config.discovery &&
                !data.config.worker &&
                " Worker status is unconfirmed; configuring a source alone does not prove a worker is running."}
            </p>
            <div className="form-section-title">
              <ShieldCheck size={17} />
              Verification preferences<span>04</span>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.requirements.website_review}
                onChange={(e) =>
                  set("requirements", {
                    ...form.requirements,
                    website_review: e.target.checked,
                  })
                }
              />
              <span>
                <strong>Queue a website evidence review</strong>
                <small>
                  Missing website links will always require manual review.
                </small>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.requirements.public_contact}
                onChange={(e) =>
                  set("requirements", {
                    ...form.requirements,
                    public_contact: e.target.checked,
                  })
                }
              />
              <span>
                <strong>
                  Only include listings with a public business contact
                </strong>
                <small>Never collect private contact information.</small>
              </span>
            </label>
            {!data.config.discovery && (
              <Notice>
                Connect a permitted Overpass endpoint in server configuration to
                enable discovery.{" "}
                <Link href="/settings">View setup instructions</Link>.
              </Notice>
            )}
            <div className="form-submit">
              <span>
                <ShieldCheck size={14} />
                No scraping. No invented leads.
              </span>
              <Button
                type="submit"
                disabled={busy || Boolean(blockedReason)}
                aria-describedby={
                  blockedReason ? "discovery-unavailable" : undefined
                }
              >
                {busy ? <Spinner /> : <Compass size={16} />}
                {busy ? "Queuing discovery…" : "Start discovery"}
                <ArrowRight size={16} />
              </Button>
            </div>
            {blockedReason && (
              <p
                className="form-submit-help"
                id="discovery-unavailable"
                role="status"
              >
                {blockedReason}{" "}
                <Link href="/settings">View setup instructions</Link>.
              </p>
            )}
          </form>
        </Panel>
        <aside className="discovery-aside">
          <div className="research-note">
            <div className="research-note-icon">
              <Compass size={25} />
            </div>
            <div className="eyebrow">GOOD RESEARCH STARTS HERE</div>
            <h2>
              Find the right fit.
              <br />
              Not just more names.
            </h2>
            <p>
              Focus on one city and one category. Review the evidence before
              deciding a business needs your help.
            </p>
            <div className="research-note-map">
              <img src="/world.svg" alt="World map illustration" />
            </div>
            <div className="research-tip">
              <ShieldCheck size={17} />
              <span>
                “No website linked” doesn’t mean
                <br />
                “no website exists.”
              </span>
            </div>
          </div>
          <Panel title="What happens next?">
            <ol className="next-steps">
              {[
                [
                  "Discover",
                  "A real provider queries permitted public records.",
                ],
                [
                  "Deduplicate",
                  "Source IDs, names, locations, and contacts are compared.",
                ],
                [
                  "Review",
                  "Check activity and website evidence independently.",
                ],
              ].map(([t, d], i) => (
                <li key={t}>
                  <span>{i + 1}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
      <Panel
        title="Discovery jobs"
        description="Queued work, provider responses, and a complete progress trail."
        action={<Badge>{data.jobs.length} jobs</Badge>}
      >
        {!data.jobs.length ? (
          <EmptyState
            compact
            icon={Compass}
            title="Your first search starts above"
            description="Discovery jobs will appear here with source details, logs, and honest progress."
          />
        ) : (
          <div className="job-list">
            {data.jobs.map((j) => {
              const jobBlocked = workerPaused && j.status === "queued";
              return (
                <div className="job-card" key={j.id}>
                  <div className="job-row">
                    <div className="job-icon">
                      <Compass size={19} />
                    </div>
                    <div className="job-name">
                      <strong>
                        {j.category.replaceAll("_", " ")} in {j.city},{" "}
                        {j.country}
                      </strong>
                      <small>
                        OpenStreetMap · {formatDate(j.created_at)} ·{" "}
                        {j.processed} / {j.total || j.max_results} processed
                      </small>
                    </div>
                    <Badge
                      tone={
                        jobBlocked || j.status === "failed"
                          ? "red"
                          : j.status === "completed"
                            ? "green"
                            : "blue"
                      }
                    >
                      {jobBlocked ? "Blocked — worker unavailable" : j.status}
                    </Badge>
                    <div className="job-controls">
                      {!jobBlocked &&
                        ["queued", "running"].includes(j.status) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Pause job"
                            onClick={() => void control(j.id, "paused")}
                          >
                            <Pause size={16} />
                          </Button>
                        )}
                      {!workerPaused &&
                        ["paused", "failed"].includes(j.status) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Resume job"
                            onClick={() => void control(j.id, "queued")}
                          >
                            <Play size={16} />
                          </Button>
                        )}
                      {!["cancelled", "completed"].includes(j.status) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Cancel job"
                          onClick={() => void control(j.id, "cancelled")}
                        >
                          <Square size={15} />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpanded(expanded === j.id ? null : j.id)
                        }
                      >
                        <Terminal size={14} />
                        Logs
                      </Button>
                    </div>
                  </div>
                  <div className="job-progress">
                    <span
                      style={{
                        width: `${j.status === "completed" ? 100 : Math.min(100, (j.processed / Math.max(1, j.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  {jobBlocked && (
                    <Notice tone="error">
                      {j.error
                        ? "Blocked — worker unavailable. A prior provider attempt failed, so this job will not retry until the worker setup is reviewed."
                        : "Blocked — worker unavailable. This job has not been sent to the provider. Resolve the worker setup before resuming it."}
                    </Notice>
                  )}
                  {j.error && (
                    <Notice tone="error">
                      {discoveryJobErrorMessage(j.error)}
                    </Notice>
                  )}
                  {expanded === j.id && (
                    <div className="job-logs">
                      {j.logs.length ? (
                        j.logs.map((l, i) => <p key={i}>{l}</p>)
                      ) : (
                        <p>
                          Waiting for a worker. Run npm run worker on a
                          configured host.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
