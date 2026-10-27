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
import { browserSupabase } from "@/lib/browser-supabase";
import { workerIsKnownPaused } from "@/lib/cloud-worker";
import type { Workspace } from "@/lib/types";
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
    env: "OVERPASS_URL=https://overpass-api.de/api/interpreter",
    help: "Set an authorised Overpass endpoint, review its usage policy, and start the separate worker. Small, bounded city queries only; respect ODbL attribution. Listings are not evidence of current operation.",
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
  lastActivity?: string | null;
};

function integrationState(
  key: string,
  data: Workspace,
  loading: boolean,
  connectionError: string | null,
): IntegrationState {
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
      label: "Worker paused",
      tone: "amber",
      configured: true,
      configuration: "Source configuration detected",
      reachability: "Not tested — no provider request was made",
      worker: "Paused — new discovery jobs are blocked",
      lastActivity: data.config.worker?.last_finished_at,
    };
  if (key === "discovery" && data.config.worker?.enabled)
    return {
      label: "Worker scheduled",
      tone: "green",
      configured: true,
      configuration: "Source configuration detected",
      reachability: "Not tested — configuration is not a provider health check",
      worker: "Scheduled",
      lastActivity: data.config.worker.last_finished_at,
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
    ...(key === "discovery" ? { worker: "Status unconfirmed" } : {}),
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
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    setDisplayName(data.user?.display_name || "");
  }, [data.user?.display_name]);
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
      <div className="settings-tabs tabs">
        {[
          ["integrations", "Integrations"],
          ["preferences", "Workspace preferences"],
          ["profile", "Profile & security"],
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
              );
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
                    {status.worker && (
                      <div>
                        <dt>Worker</dt>
                        <dd>{status.worker}</dd>
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
                  </dl>
                  <button
                    className="integration-configure"
                    onClick={() => setDetail(i.key)}
                  >
                    {status.configured
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
                onClick={async () => {
                  try {
                    const r = (await action("purge_expired", {})) as {
                      deleted: number;
                    };
                    notify(
                      `Cleanup completed. ${r.deleted || 0} expired leads removed.`,
                    );
                  } catch {}
                }}
              >
                <Trash2 size={15} />
                Delete expired leads
              </Button>
              <p className="field-help">
                Only records older than your saved retention period are removed.
              </p>
            </div>
          </Panel>
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
              <Field label="Display name">
                <input
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Button
                disabled={!displayName.trim()}
                onClick={async () => {
                  try {
                    await action("save_profile", { display_name: displayName });
                    notify("Profile updated.");
                  } catch {}
                }}
              >
                <Save size={15} />
                Save profile
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
