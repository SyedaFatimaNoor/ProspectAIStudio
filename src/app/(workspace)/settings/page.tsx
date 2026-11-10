"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database,
  Globe2,
  Sparkles,
  Mail,
  MessageCircle,
  ArrowUpRight,
  Settings2,
  ShieldCheck,
  Save,
  LogOut,
  UserRound,
  ExternalLink,
  Trash2,
  RefreshCw,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  PageHeading,
  Panel,
  Field,
  Notice,
  Badge,
  Spinner,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { browserSupabase } from "@/lib/browser-supabase";
import { workerIsKnownPaused } from "@/lib/cloud-worker";
import {
  discoveryAvailability,
  discoveryFixabilityLabel,
  safeOperationalMessage,
} from "@/lib/discovery-availability";
import { displayNameSchema } from "@/lib/validation";
import type { AIHealth } from "@/lib/ai";
import type {
  ProviderHealthRecord,
  WorkerHealth,
  WorkerJobSummary,
  Workspace,
} from "@/lib/types";
const integrations = [
  {
    key: "database",
    title: "Supabase",
    category: "DATABASE & AUTHENTICATION",
    description:
      "A private, persistent home for your workspace. PostgreSQL, authentication, and row-level security.",
    icon: Database,
    env: "NEXT_PUBLIC_SUPABASE_URL\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    help: "Set your project URL and publishable key in .env.local. Apply the migrations in supabase/migrations. Never expose a service-role key to the browser.",
    url: "https://supabase.com/docs",
  },
  {
    key: "discovery",
    title: "OpenStreetMap",
    category: "BUSINESS DISCOVERY",
    description:
      "Community-maintained business listings with source attribution. No paid API key required.",
    icon: Globe2,
    env: "OSM_SNAPSHOT=1",
    help: "Three free sources, and none of them needs a paid key. OSM_SNAPSHOT=1 searches an OpenStreetMap extract imported into the workspace database; build it locally with npm run osm:snapshot -- --load --source-url=<exact extract URL>, and it is the only source that also works on serverless hosting. OSM_EXTRACT_PATH reads a country .osm.pbf from disk and runs only in a locally started worker. OVERPASS_URL needs an endpoint whose policy explicitly permits this workload; the shared public interpreter has returned a provider-side HTTP 406, so do not rotate endpoints or spoof identity to avoid the block. Respect ODbL attribution; listings are never evidence of current operation.",
    url: "https://wiki.openstreetmap.org/wiki/Overpass_API",
  },
  {
    key: "ai",
    title: "Your AI provider",
    category: "CONCEPTS & PERSONALISATION",
    description:
      "Use Ollama Cloud or a server-side OpenAI-compatible provider for optional concept drafts.",
    icon: Sparkles,
    env: "OLLAMA_API_KEY=server-only\nOllama Cloud uses https://ollama.com and gemma4:31b\nAI_BASE_URL / AI_MODEL for another compatible provider",
    help: "Ollama Cloud and other providers are called only from server code. A local Ollama URL works only when the app server can reach it; Vercel cannot call your laptop. AI cannot browse or execute actions; supplied facts are treated as untrusted data.",
    url: "https://docs.ollama.com",
  },
  {
    key: "email",
    title: "Email provider",
    category: "OPTIONAL OUTREACH",
    description:
      "Create, edit, export, and approve email drafts. Sending is intentionally disabled.",
    icon: Mail,
    env: "Sending adapter not enabled in this release.",
    help: "No email is sent by this application. Export approved drafts for manual review in your authorised email system. Confirm consent or lawful basis, identity requirements, and opt-out handling first.",
    url: "",
  },
  {
    key: "whatsapp",
    title: "WhatsApp Business",
    category: "OPTIONAL OUTREACH",
    description:
      "Prepare business message drafts without automating a personal WhatsApp account.",
    icon: MessageCircle,
    env: "Sending adapter not enabled in this release.",
    help: "WhatsApp Business sending requires an authorised Business Platform integration, required opt-ins, and approved templates where applicable. This release provides drafts and suppression, not messaging automation.",
    url: "",
  },
];

type IntegrationState = {
  label: string;
  tone: "green" | "blue" | "amber" | "red" | "neutral";
  configured: boolean;
  configuration: string;
  reachability: string;
  worker?: string;
  quota?: string;
  snapshot?: string;
  lastActivity?: string | null;
  lastSuccessful?: string | null;
  lastError?: string | null;
};

function workerQuota(data: Workspace) {
  const worker = data.config.worker;
  if (!worker) return undefined;
  const remaining =
    worker.daily_remaining ??
    Math.max(worker.daily_limit - worker.daily_attempts, 0);
  return `${worker.daily_attempts}/${worker.daily_limit} used today (UTC); ${remaining} remaining`;
}

function snapshotDate(value: string | null | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

function workerStateLabel(worker: WorkerHealth) {
  const lifecycle =
    worker.lifecycle_state?.replaceAll("_", " ") || "configured";
  if (worker.running) return `running · ${lifecycle}`;
  if (worker.paused || !worker.enabled) return `paused · ${lifecycle}`;
  if (worker.lifecycle_state === "running")
    return "recovery pending · previous lease is no longer active";
  return lifecycle;
}

function workerJobSummary(
  summary: WorkerJobSummary | null | undefined,
  emptyLabel = "No job recorded",
) {
  if (!summary) return emptyLabel;
  const facts = [
    summary.completed_at ? snapshotDate(summary.completed_at) : null,
    typeof summary.result_count === "number"
      ? `${summary.result_count} source records`
      : null,
    typeof summary.duplicate_count === "number"
      ? `${summary.duplicate_count} duplicates`
      : null,
    typeof summary.response_time_ms === "number"
      ? `${summary.response_time_ms} ms provider response`
      : null,
    summary.error_category ? summary.error_category.replaceAll("_", " ") : null,
    summary.worker_stage
      ? `stage ${summary.worker_stage.replaceAll("_", " ")}`
      : null,
  ].filter(Boolean);
  return facts.length
    ? facts.join(" · ")
    : "Recorded without aggregate details";
}

function snapshotState(data: Workspace) {
  const snapshot = data.config.snapshot;
  if (!snapshot) return "Unavailable — snapshot migration is not installed";
  if (!snapshot.businesses || !snapshot.places)
    return "Warning — snapshot is empty. Load a lawful, attributed OSM extract before enabling discovery.";
  if (snapshot.import_status && snapshot.import_status !== "ready")
    return `Warning — snapshot import is ${snapshot.import_status}; discovery is blocked until a complete import succeeds.`;

  const businesses = snapshot.businesses_imported ?? snapshot.businesses;
  const places = snapshot.places_imported ?? snapshot.places;
  const source = snapshot.source_name
    ? ` · source ${snapshot.source_name}`
    : "";
  const dataset = snapshot.dataset_timestamp
    ? ` · dataset ${snapshotDate(snapshot.dataset_timestamp)}`
    : " · dataset timestamp unavailable";
  const coverage =
    places <= 1 || businesses < 100
      ? " · validation-scale extract, not market-wide coverage"
      : "";
  return `${businesses.toLocaleString()} imported business records · ${places.toLocaleString()} places · last successful import ${snapshotDate(snapshot.last_successful_import_at)}${dataset}${source}${coverage}`;
}

function healthTone(
  status: ProviderHealthRecord["status"],
): IntegrationState["tone"] {
  if (status === "reachable") return "green";
  if (
    status === "rate_limited" ||
    status === "blocked" ||
    status === "timeout" ||
    status === "checking" ||
    status === "paused"
  )
    return "amber";
  if (
    status === "not_configured" ||
    status === "not_applicable" ||
    status === "unavailable"
  )
    return "neutral";
  return "red";
}

function healthStatusLabel(status: ProviderHealthRecord["status"]) {
  const labels: Record<string, string> = {
    not_configured: "not configured",
    checking: "checking",
    reachable: "reachable",
    blocked: "blocked / not acceptable",
    rate_limited: "rate limited",
    timeout: "timeout",
    invalid_response: "invalid response",
    unavailable: "unavailable",
  };
  return labels[status] || status.replaceAll("_", " ");
}

function integrationState(
  key: string,
  data: Workspace,
  loading: boolean,
  connectionError: string | null,
  checkingProvider: string | null = null,
): IntegrationState {
  if (checkingProvider === key)
    return {
      label: "Checking provider",
      tone: "amber",
      configured: true,
      configuration: "Bounded provider check in progress",
      reachability: "Checking — one request, rate limited",
    };
  if (key === "email" || key === "whatsapp")
    return {
      label: "Draft only",
      tone: "neutral",
      configured: false,
      configuration: "Sending adapter is intentionally disabled",
      reachability: "Not applicable",
    };
  if (loading)
    return {
      label: "Loading status",
      tone: "neutral",
      configured: false,
      configuration: "Checking workspace configuration",
      reachability: "Not tested",
    };
  if (connectionError || data.error)
    return {
      label: "Status unavailable",
      tone: "red",
      configured: false,
      configuration: "Could not refresh workspace status",
      reachability: "Unknown",
    };
  const configured =
    key === "database"
      ? data.config.database
      : key === "discovery"
        ? data.config.discovery
        : key === "ai"
          ? data.config.ai
          : false;
  if (!configured)
    return {
      label: "Not configured",
      tone: "amber",
      configured: false,
      configuration: "Required server configuration is missing",
      reachability: "Not tested",
      ...(key === "discovery" && data.user
        ? { snapshot: snapshotState(data) }
        : {}),
    };
  if (!data.user)
    return {
      label: "Preview: setup detected",
      tone: "blue",
      configured: true,
      configuration: "Environment configuration detected",
      reachability: "Not tested from a read-only preview",
    };
  if (key === "database")
    return {
      label: "Workspace connected",
      tone: "green",
      configured: true,
      configuration: "Configured for this workspace",
      reachability: "Workspace API connected",
    };
  if (key === "discovery" && workerIsKnownPaused(data.config.worker))
    return {
      label:
        data.config.worker?.lifecycle_state === "blocked"
          ? "Worker blocked"
          : "Worker paused",
      tone: "amber",
      configured: true,
      configuration: "Source configuration detected",
      reachability: "Not tested — no provider request was made",
      worker: data.config.self_hosted_worker
        ? "Hosted scheduler paused — a locally configured worker still runs queued jobs"
        : data.config.worker?.lifecycle_state === "blocked"
          ? "Blocked after a provider/policy error — do not retry until the source setup is reviewed"
          : "Paused — new discovery jobs are blocked",
      snapshot: snapshotState(data),
      quota: workerQuota(data),
      lastActivity: data.config.worker?.last_finished_at,
      lastSuccessful: data.config.worker?.last_successful_at,
      lastError: data.config.worker?.last_error,
    };
  if (
    key === "discovery" &&
    data.config.worker?.lifecycle_state === "rate_limited"
  )
    return {
      label: "Worker rate limited",
      tone: "amber",
      configured: true,
      configuration: "Source configuration detected",
      reachability:
        "Waiting for the provider retry window; no request was made by this status refresh",
      worker: "Rate limited — automatic retry remains bounded",
      snapshot: snapshotState(data),
      quota: workerQuota(data),
      lastActivity: data.config.worker.last_finished_at,
      lastSuccessful: data.config.worker.last_successful_at,
      lastError: data.config.worker.last_error,
    };
  if (key === "discovery" && data.config.worker?.enabled)
    return {
      label: data.config.worker.running ? "Worker running" : "Worker scheduled",
      tone: "green",
      configured: true,
      configuration: "Source configuration detected",
      reachability: "Not tested — configuration is not a provider health check",
      worker: "Scheduled",
      snapshot: snapshotState(data),
      quota: workerQuota(data),
      lastActivity: data.config.worker.last_finished_at,
      lastSuccessful: data.config.worker.last_successful_at,
      lastError: data.config.worker.last_error,
    };
  return {
    label:
      key === "discovery"
        ? "Configured — worker status unconfirmed"
        : "Configured — not tested",
    tone: "blue",
    configured: true,
    configuration: "Configured for this workspace",
    reachability: "Not tested — configuration is not a provider health check",
    ...(key === "discovery"
      ? {
          worker: "Status unconfirmed",
          snapshot: snapshotState(data),
          quota: workerQuota(data),
          lastActivity: data.config.worker?.last_finished_at,
          lastSuccessful: data.config.worker?.last_successful_at,
          lastError: data.config.worker?.last_error,
        }
      : {}),
  };
}

export default function Settings() {
  const { data, loading, connectionError, action, notify, refresh } =
    useWorkspace();
  const router = useRouter();
  const [tab, setTab] = useState("integrations");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [aiHealth, setAiHealth] = useState<AIHealth | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);
  const displayNameValidation = displayNameSchema.safeParse(displayName);
  const profileDirty = displayName !== (data.user?.display_name || "");
  useEffect(() => {
    setDisplayName(data.user?.display_name || "");
    setProfileSavedAt(data.user?.updated_at || null);
  }, [data.user?.display_name, data.user?.updated_at]);
  const [form, setForm] = useState({
    search_limit: 25,
    verification_threshold: 85,
    retention_days: 90,
  });
  useEffect(() => {
    if (data.settings) setForm(data.settings);
  }, [data.settings]);
  const current = integrations.find((i) => i.key === detail);
  async function save() {
    setBusy(true);
    try {
      await action("save_settings", form);
      notify("Workspace preferences saved.");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function checkStatus() {
    setCheckingStatus(true);
    const refreshed = await refresh();
    setStatusMessage(
      refreshed
        ? `Workspace status refreshed at ${new Date().toLocaleTimeString()}. This reads saved configuration and worker state; it does not probe external providers.`
        : "Unable to refresh workspace status. Check the connection and try again.",
    );
    setCheckingStatus(false);
  }
  async function testAiConnection() {
    setCheckingAi(true);
    setAiHealth(null);
    try {
      const health = (await action("test_ai", {})) as AIHealth;
      if (!health.reply || !health.provider || !health.model)
        throw new Error("AI provider returned an incomplete health response.");
      setAiHealth(health);
      notify(`AI connection verified in ${health.latencyMs} ms.`);
    } catch {
      // WorkspaceProvider already presents the server's controlled error.
    } finally {
      setCheckingAi(false);
    }
  }
  async function testProviderConnection(
    provider: "database" | "discovery" | "worker",
  ) {
    setCheckingProvider(provider);
    try {
      const health = (await action("test_provider", {
        provider,
      })) as ProviderHealthRecord;
      notify(
        `${provider === "database" ? "Supabase" : provider === "discovery" ? "Discovery source" : "Worker"} check: ${healthStatusLabel(health.status)}${health.latency_ms !== null ? ` in ${health.latency_ms} ms` : ""}.`,
        health.status !== "reachable",
      );
    } catch {
      // WorkspaceProvider already presents the controlled server-side error.
    } finally {
      setCheckingProvider(null);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="A WORKSPACE THAT WORKS FOR YOU"
        title="Settings & integrations"
        description="Connect your tools. Set your boundaries. Keep control of your data."
      >
        <Button
          variant="outline"
          disabled={checkingStatus}
          onClick={() => void checkStatus()}
        >
          {checkingStatus ? <Spinner /> : <RefreshCw size={15} />}
          {checkingStatus ? "Refreshing status…" : "Refresh workspace status"}
        </Button>
      </PageHeading>
      {statusMessage && (
        <p className="settings-status-feedback" role="status">
          {statusMessage}
        </p>
      )}
      <Tabs
        className="settings-tabs tabs"
        label="Settings sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: "integrations", label: "Integrations" },
          { value: "preferences", label: "Workspace preferences" },
          { value: "profile", label: "Profile & security" },
        ]}
      />
      {tab === "integrations" && (
        <>
          <div className="settings-intro">
            <span className="settings-intro-icon">
              <KeyRound size={20} />
            </span>
            <div>
              <strong>Your keys stay on your server.</strong>
              <p>
                Credentials are configured through environment variables, never
                in browser storage or public tables.
              </p>
            </div>
            <Badge tone="green">Secure by design</Badge>
          </div>
          <div className="integrations-grid">
            {integrations.map((i) => {
              const status = integrationState(
                i.key,
                data,
                loading,
                connectionError,
                checkingProvider,
              );
              const providerHealth = data.provider_health.find(
                (health) => health.provider === i.key,
              );
              const workerHealth =
                i.key === "discovery"
                  ? data.provider_health.find(
                      (health) => health.provider === "worker",
                    )
                  : undefined;
              const availability =
                i.key === "discovery"
                  ? discoveryAvailability(data, loading, connectionError)
                  : null;
              const healthProviders = [
                ...(i.key === "database" || i.key === "discovery"
                  ? [i.key]
                  : []),
                ...(i.key === "discovery" && data.config.worker
                  ? ["worker"]
                  : []),
              ] as ("database" | "discovery" | "worker")[];
              return (
                <div className="integration-card" key={i.key}>
                  <div className="integration-card-top">
                    <span className={`integration-logo ${i.key}`}>
                      <i.icon size={25} />
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="eyebrow">{i.category}</div>
                  <h2>{i.title}</h2>
                  <p>{i.description}</p>
                  <dl className="integration-status-list">
                    <div>
                      <dt>Configuration</dt>
                      <dd>{status.configuration}</dd>
                    </div>
                    <div>
                      <dt>Reachability</dt>
                      <dd>{status.reachability}</dd>
                    </div>
                    {availability && (
                      <>
                        <div>
                          <dt>Discovery availability</dt>
                          <dd>
                            {availability.available
                              ? "Available to queue bounded work"
                              : "Discovery unavailable"}
                          </dd>
                        </div>
                        <div>
                          <dt>Exact reason</dt>
                          <dd>{safeOperationalMessage(availability.reason)}</dd>
                        </div>
                        <div>
                          <dt>Last worker activity</dt>
                          <dd>
                            {availability.lastWorkerActivity
                              ? snapshotDate(availability.lastWorkerActivity)
                              : "No worker activity recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last provider check</dt>
                          <dd>
                            {availability.lastProviderCheck
                              ? `${snapshotDate(availability.lastProviderCheck.checked_at)} · ${availability.lastProviderCheck.status.replaceAll("_", " ")}`
                              : "No provider check recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last HTTP status</dt>
                          <dd>
                            {availability.lastHttpStatus
                              ? `HTTP ${availability.lastHttpStatus}`
                              : "No HTTP status recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Response time</dt>
                          <dd>
                            {typeof availability.responseTimeMs === "number"
                              ? `${availability.responseTimeMs} ms`
                              : "No response time recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Recommended action</dt>
                          <dd>{availability.recommendedAction}</dd>
                        </div>
                        <div>
                          <dt>Who can fix this?</dt>
                          <dd>
                            {discoveryFixabilityLabel(availability.fixability)}
                          </dd>
                        </div>
                      </>
                    )}
                    {status.worker && (
                      <div>
                        <dt>Worker</dt>
                        <dd>{status.worker}</dd>
                      </div>
                    )}
                    {status.snapshot && (
                      <div>
                        <dt>OSM snapshot</dt>
                        <dd>{status.snapshot}</dd>
                      </div>
                    )}
                    {status.quota && (
                      <div>
                        <dt>Daily worker quota</dt>
                        <dd>{status.quota}</dd>
                      </div>
                    )}
                    {status.lastActivity && (
                      <div>
                        <dt>Last worker activity</dt>
                        <dd>
                          {new Date(status.lastActivity).toLocaleString()}
                        </dd>
                      </div>
                    )}
                    {status.lastSuccessful && (
                      <div>
                        <dt>Last successful worker run</dt>
                        <dd>
                          {new Date(status.lastSuccessful).toLocaleString()}
                        </dd>
                      </div>
                    )}
                    {status.lastError && (
                      <div>
                        <dt>Last worker outcome</dt>
                        <dd>{safeOperationalMessage(status.lastError)}</dd>
                      </div>
                    )}
                    {i.key === "discovery" && data.config.worker && (
                      <>
                        <div>
                          <dt>Worker lifecycle</dt>
                          <dd>{workerStateLabel(data.config.worker)}</dd>
                        </div>
                        <div>
                          <dt>Last heartbeat</dt>
                          <dd>
                            {data.config.worker.last_heartbeat_at
                              ? snapshotDate(
                                  data.config.worker.last_heartbeat_at,
                                )
                              : "No heartbeat recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Worker version</dt>
                          <dd>
                            {data.config.worker.worker_version ||
                              "No version reported"}
                          </dd>
                        </div>
                        <div>
                          <dt>Provider/source</dt>
                          <dd>
                            {data.config.worker.provider_source ||
                              "No source reported"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last successful job</dt>
                          <dd>
                            {workerJobSummary(
                              data.config.worker.last_successful_job,
                              data.config.worker.last_successful_job_at
                                ? snapshotDate(
                                    data.config.worker.last_successful_job_at,
                                  )
                                : "No successful job recorded",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Last failed job</dt>
                          <dd>
                            {workerJobSummary(
                              data.config.worker.last_failed_job,
                              data.config.worker.last_failed_job_at
                                ? snapshotDate(
                                    data.config.worker.last_failed_job_at,
                                  )
                                : "No failed or blocked job recorded",
                            )}
                          </dd>
                        </div>
                        {data.config.worker.last_failed_stage && (
                          <div>
                            <dt>Last failed stage</dt>
                            <dd>
                              {data.config.worker.last_failed_stage.replaceAll(
                                "_",
                                " ",
                              )}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>Last provider error</dt>
                          <dd>
                            {safeOperationalMessage(
                              data.config.worker.last_provider_error,
                              "No provider error recorded",
                            )}
                            {data.config.worker.last_error_category
                              ? ` (${data.config.worker.last_error_category.replaceAll("_", " ")})`
                              : ""}
                          </dd>
                        </div>
                      </>
                    )}
                    {data.config.provider_health_error && (
                      <div>
                        <dt>Health history warning</dt>
                        <dd>
                          {safeOperationalMessage(
                            data.config.provider_health_error,
                          )}
                        </dd>
                      </div>
                    )}
                    {providerHealth && (
                      <>
                        <div>
                          <dt>Provider configured</dt>
                          <dd>
                            {providerHealth.provider_configured === false
                              ? "Not configured"
                              : status.configured
                                ? "Configured"
                                : "Not configured"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last provider check</dt>
                          <dd>
                            {new Date(
                              providerHealth.requested_at ||
                                providerHealth.checked_at,
                            ).toLocaleString()}
                          </dd>
                        </div>
                        <div>
                          <dt>Health result</dt>
                          <dd>
                            {checkingProvider === i.key
                              ? "checking"
                              : healthStatusLabel(providerHealth.status)}
                          </dd>
                        </div>
                        <div>
                          <dt>HTTP status</dt>
                          <dd>
                            {typeof providerHealth.http_status === "number"
                              ? `HTTP ${providerHealth.http_status}`
                              : "No HTTP status recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Response time</dt>
                          <dd>
                            {typeof (providerHealth.response_time_ms ??
                              providerHealth.latency_ms) === "number"
                              ? `${providerHealth.response_time_ms ?? providerHealth.latency_ms} ms`
                              : "No response time recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Response valid</dt>
                          <dd>
                            {providerHealth.response_valid === null ||
                            providerHealth.response_valid === undefined
                              ? "Not tested"
                              : providerHealth.response_valid
                                ? "Yes"
                                : "No"}
                          </dd>
                        </div>
                        {providerHealth.provider_hostname && (
                          <div>
                            <dt>Provider hostname</dt>
                            <dd>{providerHealth.provider_hostname}</dd>
                          </div>
                        )}
                        {providerHealth.last_success_at && (
                          <div>
                            <dt>Last successful check</dt>
                            <dd>
                              {new Date(
                                providerHealth.last_success_at,
                              ).toLocaleString()}
                            </dd>
                          </div>
                        )}
                        {providerHealth.last_failed_at && (
                          <div>
                            <dt>Last failed check</dt>
                            <dd>
                              {new Date(
                                providerHealth.last_failed_at,
                              ).toLocaleString()}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>Last error</dt>
                          <dd>
                            {providerHealth.last_error
                              ? safeOperationalMessage(
                                  providerHealth.last_error,
                                )
                              : "No last error recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt>Recommended action</dt>
                          <dd>
                            {safeOperationalMessage(
                              providerHealth.recommended_action,
                            )}
                          </dd>
                        </div>
                      </>
                    )}
                    {workerHealth && (
                      <>
                        <div>
                          <dt>Last scheduler check</dt>
                          <dd>
                            {new Date(workerHealth.checked_at).toLocaleString()}
                          </dd>
                        </div>
                        <div>
                          <dt>Scheduler result</dt>
                          <dd>{healthStatusLabel(workerHealth.status)}</dd>
                        </div>
                        {workerHealth.last_success_at && (
                          <div>
                            <dt>Last successful worker run</dt>
                            <dd>
                              {new Date(
                                workerHealth.last_success_at,
                              ).toLocaleString()}
                            </dd>
                          </div>
                        )}
                        {workerHealth.last_error && (
                          <div>
                            <dt>Last scheduler check error</dt>
                            <dd>
                              {safeOperationalMessage(workerHealth.last_error)}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>Scheduler guidance</dt>
                          <dd>
                            {safeOperationalMessage(
                              workerHealth.recommended_action,
                            )}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {providerHealth && (
                    <Badge tone={healthTone(providerHealth.status)}>
                      Last check: {healthStatusLabel(providerHealth.status)}
                    </Badge>
                  )}
                  {healthProviders.length > 0 && data.user && (
                    <div className="integration-health">
                      {healthProviders.map((provider) => (
                        <Button
                          key={provider}
                          variant="outline"
                          size="sm"
                          disabled={checkingProvider !== null}
                          onClick={() => void testProviderConnection(provider)}
                        >
                          {checkingProvider === provider ? (
                            <Spinner />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          {checkingProvider === provider
                            ? "Checking provider…"
                            : provider === "worker"
                              ? "Check worker status"
                              : "Test provider connection"}
                        </Button>
                      ))}
                    </div>
                  )}
                  {i.key === "ai" && status.configured && data.user && (
                    <div className="integration-health">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={checkingAi}
                        onClick={() => void testAiConnection()}
                      >
                        {checkingAi ? <Spinner /> : <Sparkles size={14} />}
                        {checkingAi ? "Testing AI…" : "Test AI connection"}
                      </Button>
                      {aiHealth && (
                        <div
                          className="integration-health-result"
                          role="status"
                        >
                          <strong>
                            Actual reply · {aiHealth.provider} ·{" "}
                            {aiHealth.model} · {aiHealth.latencyMs} ms
                          </strong>
                          <p>{aiHealth.reply}</p>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    className="integration-configure"
                    onClick={() => setDetail(i.key)}
                  >
                    {i.key === "discovery" &&
                    availability &&
                    !availability.available
                      ? "View setup instructions"
                      : status.configured
                        ? "View configuration"
                        : "Setup & limitations"}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              );
            })}
            <div className="integration-future">
              <ShieldCheck size={30} />
              <h3>Optional by design.</h3>
              <p>
                Start with manual research and fact-based drafts. Add providers
                only when you need them.
              </p>
            </div>
          </div>
          <Notice>
            Configuration, reachability, and worker scheduling are separate
            states. A configured source is not a successful provider check. The
            status refresh reads saved workspace and worker state without
            sending a provider request; database and job errors remain visible
            in the workspace and job logs.
          </Notice>
        </>
      )}
      {tab === "preferences" && (
        <div className="settings-form-layout">
          <Panel
            title="Search & verification"
            description="Sensible limits for a thoughtful research workflow."
          >
            <div className="panel-body form-stack">
              <Field
                label="Default search limit"
                hint="Maximum listings allowed per discovery job (1–100)."
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.search_limit}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      search_limit: Number(e.target.value),
                    }))
                  }
                />
              </Field>
              <Field
                label="Verification confidence threshold"
                hint="Preferred minimum confidence for review (50–100). A score is never proof; this preference does not override evidence requirements."
              >
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={form.verification_threshold}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      verification_threshold: Number(e.target.value),
                    }))
                  }
                />
              </Field>
              <Field
                label="Lead retention period (days)"
                hint="7–365 days. The worker purges expired leads daily. You can also run cleanup below."
              >
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={form.retention_days}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      retention_days: Number(e.target.value),
                    }))
                  }
                />
              </Field>
              <Button disabled={busy} onClick={() => void save()}>
                <Save size={15} />
                Save preferences
              </Button>
            </div>
          </Panel>
          <Panel
            title="Data control"
            description="Keep only the research you need."
          >
            <div className="panel-body form-stack">
              <Notice>
                Deleting a lead also deletes its sources, verification runs,
                website candidates, proposals, drafts, and related message
                events. Suppression records are retained to honour opt-outs.
              </Notice>
              <Button
                variant="outline"
                disabled={purging}
                onClick={() => setPurgeOpen(true)}
              >
                <Trash2 size={15} />
                Delete expired leads
              </Button>
              <p className="field-help">
                Only records older than your saved retention period are removed.
              </p>
            </div>
          </Panel>
          <Dialog
            open={purgeOpen}
            onOpenChange={(open) => !purging && setPurgeOpen(open)}
            title="Delete expired leads?"
          >
            <p>
              This permanently deletes leads older than your saved retention
              period, together with their sources, evidence, proposals, drafts,
              and related message events. Suppression records are retained to
              honour opt-outs.
            </p>
            <p className="field-help">
              Retention period: {form.retention_days} days. The server reports
              the exact affected-row count after cleanup.
            </p>
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={purging}
                onClick={() => setPurgeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={purging}
                onClick={async () => {
                  setPurging(true);
                  try {
                    const r = (await action("purge_expired", {})) as {
                      deleted: number;
                    };
                    notify(
                      `Cleanup completed. ${r.deleted || 0} expired leads removed.`,
                    );
                    setPurgeOpen(false);
                  } catch {
                  } finally {
                    setPurging(false);
                  }
                }}
              >
                {purging ? <Spinner /> : <Trash2 size={15} />}
                {purging ? "Deleting…" : "Confirm deletion"}
              </Button>
            </div>
          </Dialog>
        </div>
      )}
      {tab === "profile" && (
        <div className="settings-form-layout">
          <Panel
            title="Your profile"
            description="A clear identity for your workspace."
          >
            <div className="panel-body form-stack">
              <Field label="Email address">
                <input readOnly value={data.user?.email || "Not signed in"} />
              </Field>
              <Field
                label="Display name"
                error={
                  displayName
                    ? displayNameValidation.success
                      ? undefined
                      : displayNameValidation.error.issues[0]?.message
                    : undefined
                }
                hint="Up to 80 visible characters. Names may include international letters and punctuation."
              >
                <input
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              {profileDirty && (
                <p className="field-help" role="status">
                  You have unsaved profile changes.
                </p>
              )}
              {profileSavedAt && !profileDirty && (
                <p className="field-help" role="status">
                  Profile saved successfully ·{" "}
                  {new Date(profileSavedAt).toLocaleString()}.
                </p>
              )}
              <Button
                disabled={
                  profileSaving ||
                  !profileDirty ||
                  !displayNameValidation.success
                }
                onClick={async () => {
                  setProfileSaving(true);
                  try {
                    const profile = (await action("save_profile", {
                      display_name: displayName,
                    })) as { updated_at?: string };
                    setProfileSavedAt(
                      profile.updated_at || new Date().toISOString(),
                    );
                    notify("Profile saved successfully.");
                  } catch {
                    // WorkspaceProvider shows the controlled error notification.
                  } finally {
                    setProfileSaving(false);
                  }
                }}
              >
                {profileSaving ? <Spinner /> : <Save size={15} />}
                {profileSaving ? "Saving profile…" : "Save profile"}
              </Button>
            </div>
          </Panel>
          <Panel
            title="Security & session"
            description="Your data is isolated by user-level database policies."
          >
            <div className="panel-body form-stack">
              <Notice>
                Supabase manages authentication. Use a unique password and keep
                your account confirmation email secure.
              </Notice>
              <Button
                variant="outline"
                onClick={async () => {
                  await browserSupabase()?.auth.signOut();
                  router.push("/sign-in");
                  router.refresh();
                }}
              >
                <LogOut size={15} />
                {data.user ? "Sign out of workspace" : "Go to sign in"}
              </Button>
              <p className="field-help">
                Admin credentials and provider secrets are never exposed by the
                settings API.
              </p>
            </div>
          </Panel>
        </div>
      )}
      <Dialog
        open={!!current}
        onOpenChange={(v) => !v && setDetail(null)}
        title={current?.title || "Integration"}
        description="Server-side configuration and provider limitations."
      >
        {current && (
          <div className="form-stack">
            <p className="muted">{current.help}</p>
            <pre className="config-code">{current.env}</pre>
            <Notice>
              Restart the application after changing environment variables.
              Never commit .env.local or share full secret keys.
            </Notice>
            {current.url && (
              <Button variant="outline" asChild>
                <a href={current.url} target="_blank" rel="noreferrer">
                  Provider documentation
                  <ExternalLink size={14} />
                </a>
              </Button>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
