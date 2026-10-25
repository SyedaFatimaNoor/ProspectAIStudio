"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";

// One consistent first-run guide across workspace routes, never sample records.
export function WorkspaceOnboarding() {
  const { data, loading, connectionError, refresh } = useWorkspace();
  const path = usePathname();
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }
  if (loading)
    return (
      <div className="onboarding-loading">Loading workspace requirements…</div>
    );
  if (connectionError)
    return (
      <aside
        className="workspace-onboarding onboarding-connection"
        aria-label="Workspace connection"
      >
        <div>
          <strong>Workspace connection needs attention</strong>
          <p>
            {connectionError} Previously loaded records may be stale; account
            and setup status cannot be confirmed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? "Checking connection…" : "Retry connection"}
        </Button>
      </aside>
    );
  if (data.user && data.businesses.length > 0) return null;

  const worker = data.config.worker;
  const needsSetup =
    !data.config.database ||
    !data.config.discovery ||
    worker?.enabled === false;
  const completedSearch = data.jobs.some((j) => j.status === "completed");
  const activeSearch = data.jobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  const failedSearch = data.jobs.some((j) => j.status === "failed");
  const steps = [
    {
      title: "Sign in to save",
      done: Boolean(data.user),
      detail: data.user
        ? "Authenticated account. Successful saves belong to this workspace."
        : "Browse pages and try the form in preview. Sign in before saving, queuing or approving anything.",
    },
    {
      title: "Check source & worker",
      done:
        data.config.database &&
        data.config.discovery &&
        worker?.enabled === true,
      detail: !data.config.database
        ? "Operator setup: connect Supabase for account storage."
        : !data.config.discovery
          ? "Operator setup: configure a permitted public source and a bounded worker."
          : worker?.enabled === false
            ? "Cloud worker paused. The operator must resolve the provider/setup issue; queued jobs cannot run."
            : worker?.enabled
              ? `Cloud scheduling enabled, capped at ${worker.daily_limit} attempts/day. This is not proof of provider availability.`
              : "Source configured; worker status unconfirmed. Check setup before expecting live results.",
    },
    {
      title: "Run a bounded search",
      done: completedSearch,
      detail: completedSearch
        ? "A completed search is recorded. Check its logs and actual result count."
        : activeSearch
          ? "A queued/running job is recorded—not a completed search. Follow its logs on Discovery."
          : failedSearch
            ? "An attempt failed. Review the job error and resolve access before retrying."
            : "Choose one city and category. Queued is not completed; errors stay visible in job logs.",
    },
    {
      title: "Review the evidence",
      done: data.runs.some((r) => r.status === "completed"),
      detail:
        "Review source links and timestamps. Listing-only review does not establish activity, website ownership or website absence.",
    },
  ];
  return (
    <details className="workspace-onboarding" open={path === "/overview"}>
      <summary>
        <div>
          <strong>Your first research workflow</strong>
          <span>
            {data.user
              ? "Start with a source, then review the evidence."
              : "Read-only preview · no changes saved and no sample leads inserted."}
          </span>
        </div>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="onboarding-content">
        <ol>
          {steps.map((step, i) => (
            <li
              key={step.title}
              className={step.done ? "onboarding-step-done" : ""}
            >
              <span className="onboarding-step-number" aria-hidden="true">
                {step.done ? <Check size={15} /> : i + 1}
              </span>
              <div>
                <strong>
                  {step.title}
                  <span className="sr-only">
                    {step.done ? " — recorded" : " — next step"}
                  </span>
                </strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="onboarding-bottom">
          <p>
            <strong>AI is optional.</strong> Fact-based concepts do not need a
            paid model. Outreach remains draft-only; no sending adapters are
            enabled.
          </p>
          <Button asChild size="sm">
            <Link
              href={
                !data.user
                  ? "/sign-in"
                  : needsSetup
                    ? "/settings"
                    : "/discovery"
              }
            >
              {!data.user
                ? "Sign in to save research"
                : needsSetup
                  ? "View setup instructions"
                  : "Open discovery"}
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
        <p className="onboarding-disclaimer">
          Any examples on the public landing page are illustrative—not
          discovered businesses. Nothing in this guide connects a provider or
          enables a worker automatically.
        </p>
      </div>
    </details>
  );
}
