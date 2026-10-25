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
      "Connect a local model through Ollama or your preferred OpenAI-compatible provider.",
    icon: Sparkles,
    env: "AI_BASE_URL=http://127.0.0.1:11434/v1\nAI_MODEL=your-installed-model\nAI_API_KEY=optional",
    help: "Use a locally installed model at no provider cost, subject to your own hardware. Configuration is server-only. AI cannot browse or execute actions; supplied facts are treated as untrusted data.",
    url: "https://github.com/ollama/ollama",
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
export default function Settings() {
  const { data, action, notify, refresh } = useWorkspace();
  const router = useRouter();
  const [tab, setTab] = useState("integrations");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  return (
    <>
      <PageHeading
        eyebrow="A WORKSPACE THAT WORKS FOR YOU"
        title="Settings & integrations"
        description="Connect your tools. Set your boundaries. Keep control of your data."
      >
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Check status
        </Button>
      </PageHeading>
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
              const connected =
                data.config[i.key as keyof typeof data.config] || false;
              return (
                <div className="integration-card" key={i.key}>
                  <div className="integration-card-top">
                    <span className={`integration-logo ${i.key}`}>
                      <i.icon size={25} />
                    </span>
                    <Badge
                      tone={
                        connected
                          ? "green"
                          : i.key === "email" || i.key === "whatsapp"
                            ? "neutral"
                            : "amber"
                      }
                    >
                      {connected
                        ? "Configured"
                        : i.key === "email" || i.key === "whatsapp"
                          ? "Draft only"
                          : "Not configured"}
                    </Badge>
                  </div>
                  <div className="eyebrow">{i.category}</div>
                  <h2>{i.title}</h2>
                  <p>{i.description}</p>
                  <button
                    className="integration-configure"
                    onClick={() => setDetail(i.key)}
                  >
                    {connected ? "View configuration" : "Setup & limitations"}
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
            “Configured” means the required environment variables are present.
            It does not guarantee provider reachability. Database and job errors
            are surfaced in the workspace and job logs.
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
