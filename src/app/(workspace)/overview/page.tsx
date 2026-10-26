"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Compass,
  Building2,
  ShieldCheck,
  Globe2,
  FileText,
  Send,
  ChevronDown,
  Check,
  ExternalLink,
  Clock3,
  Activity,
  SlidersHorizontal,
  Sparkles,
  MapPin,
  CalendarDays,
  CheckCheck,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { PageHeading, Panel, EmptyState, Badge } from "@/components/shared";
import { formatDate } from "@/lib/utils";
export default function Overview() {
  const { data, loading, connectionError } = useWorkspace();
  const [period, setPeriod] = useState("30");
  const cutoff = Date.now() - Number(period) * 86400000;
  const leads = data.businesses.filter(
    (b) => new Date(b.created_at).getTime() >= cutoff,
  );
  const verified = leads.filter(
    (b) => b.activity_status === "verified_active",
  ).length;
  const noWebsite = leads.filter(
    (b) => b.website_status === "no_website_high_confidence",
  ).length;
  const awaiting = leads.filter((b) =>
    ["Unverified", "Manual review required"].includes(b.verification_status),
  ).length;
  const metrics = [
    {
      label: "Discovered businesses",
      value: leads.length,
      icon: Building2,
      tone: "blue",
      detail: "Your pipeline starts here",
      link: "/leads",
    },
    {
      label: "Verified active",
      value: verified,
      icon: ShieldCheck,
      tone: "green",
      detail: "Backed by public evidence",
      link: "/verification",
    },
    {
      label: "No website found",
      value: noWebsite,
      icon: Globe2,
      tone: "violet",
      detail: "High-confidence opportunities",
      link: "/leads?status=no_website_high_confidence",
    },
    {
      label: "Awaiting verification",
      value: awaiting,
      icon: Clock3,
      tone: "amber",
      detail: "Ready for a closer look",
      link: "/verification",
    },
  ];
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 13 + i);
    return {
      date,
      count: leads.filter(
        (b) => new Date(b.created_at).toDateString() === date.toDateString(),
      ).length,
    };
  });
  const max = Math.max(2, ...days.map((d) => d.count));
  return (
    <>
      <PageHeading
        eyebrow="YOUR OPPORTUNITY, IN FOCUS"
        title="Workspace overview"
        description="A clearer picture of your pipeline. A better way to find your next client."
      >
        <label className="date-select">
          <CalendarDays size={15} />
          <select
            aria-label="Dashboard period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="30">Last 30 days</option>
            <option value="7">Last 7 days</option>
            <option value="365">Last 12 months</option>
          </select>
        </label>
        <Button asChild>
          <Link href="/discovery">
            <Plus size={17} />
            New discovery
          </Link>
        </Button>
      </PageHeading>
      {!data.user && !connectionError && (
        <div className="preview-banner">
          <span>
            <span className="preview-dot" />
            <strong>A fresh workspace, full of possibility.</strong> You’re in
            read-only preview. Sign in to save your first real lead.
          </span>
          <Link href="/sign-in">
            Set up your workspace <ArrowRight size={14} />
          </Link>
        </div>
      )}
      <section className="welcome-banner">
        <div className="welcome-content">
          <div className="hero-label">
            <span />
            THE NEXT GREAT BUSINESS IS OUT THERE
          </div>
          <h2>
            Discover potential.
            <br />
            <span>Build real connections.</span>
          </h2>
          <p>
            Find businesses that could use a better online presence.
            <br className="desktop-only" /> Verify the evidence. Make your
            introduction count.
          </p>
          <Button asChild>
            <Link href="/discovery">
              <Compass size={16} />
              Start discovering
              <ArrowRight size={16} />
            </Link>
          </Button>
          <span className="welcome-footnote">
            <ShieldCheck size={13} />
            Real sources. No invented leads.
          </span>
        </div>
        <div className="welcome-map" aria-hidden="true">
          <div className="map-grid" />
          <img src="/world.svg" alt="" />
          <svg className="map-connections" viewBox="0 0 600 300">
            <path d="M140 105 Q300 -20 420 113 M140 105 Q190 200 285 175 M285 175 Q350 30 420 113 M420 113 Q480 140 475 222" />
            <circle cx="140" cy="105" r="5" />
            <circle cx="285" cy="175" r="5" />
            <circle cx="420" cy="113" r="5" />
            <circle cx="475" cy="222" r="5" />
          </svg>
          <span className="map-label map-label-one">
            <span className="map-mini-icon">
              <Building2 size={14} />
            </span>
            <span>
              Local businesses<strong>Global possibilities</strong>
            </span>
            <span className="map-label-dot" />
          </span>
          <span className="map-label map-label-two">
            <ShieldCheck size={16} />
            <span>Evidence comes first</span>
          </span>
          <div className="map-caption">
            <span />A world of untapped potential
          </div>
        </div>
      </section>
      <div className="metrics-grid">
        {metrics.map((m) => (
          <Link href={m.link} className="metric-card" key={m.label}>
            <div className="metric-label">
              {m.label}
              <span className={`metric-icon ${m.tone}`}>
                <m.icon size={17} />
              </span>
            </div>
            <div className="metric-value">
              {loading ? "—" : m.value.toLocaleString()}
              <ArrowUpRight size={18} />
            </div>
            <div className="metric-detail">
              <span className={`tiny-dot ${m.tone}`} />
              {m.detail}
            </div>
          </Link>
        ))}
      </div>
      <div className="overview-middle">
        <Panel
          title="Discovery activity"
          description="Every meaningful connection starts with a little research."
          action={
            <span className="chart-legend">
              <span />
              Businesses discovered
            </span>
          }
        >
          <div className="chart-summary">
            <strong>{leads.length}</strong>
            <span>businesses in this period</span>
            <span className="muted chart-period">
              Daily activity · last 14 days
            </span>
          </div>
          <div className="activity-chart">
            <div className="chart-y">
              <span>{max}</span>
              <span>{Math.round(max / 2)}</span>
              <span>0</span>
            </div>
            <div className="chart-plot">
              <div className="chart-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="chart-bars">
                {days.map((d, i) => (
                  <div className="chart-bar-slot" key={i}>
                    <div
                      title={`${formatDate(d.date.toISOString())}: ${d.count} businesses`}
                      className="chart-bar"
                      style={{
                        height: d.count ? `${(d.count / max) * 100}%` : "2px",
                      }}
                    />
                  </div>
                ))}
              </div>
              {!leads.length && (
                <div className="chart-empty">
                  <span className="chart-empty-icon">
                    <Activity size={18} />
                  </span>
                  <strong>Your momentum starts with one search</strong>
                  <span>Real discovery activity will appear here.</span>
                </div>
              )}
            </div>
          </div>
          <div className="chart-x">
            {[0, 3, 6, 9, 13].map((i) => (
              <span key={i}>{formatDate(days[i].date.toISOString())}</span>
            ))}
          </div>
          <div className="chart-bottom">
            <ShieldCheck size={14} />
            <span>
              Only real, source-backed discoveries. Never simulated results.
            </span>
            <Link href="/discovery">
              Find your first leads <ArrowRight size={13} />
            </Link>
          </div>
        </Panel>
        <Panel
          title="Your pipeline, at a glance"
          description="From discovery to the first hello."
          className="pipeline-panel"
        >
          <div className="pipeline-steps">
            {[
              {
                label: "Businesses discovered",
                value: leads.length,
                icon: Compass,
                tone: "blue",
              },
              {
                label: "Verified opportunities",
                value: noWebsite,
                icon: ShieldCheck,
                tone: "green",
              },
              {
                label: "Proposals created",
                value: data.proposals.length,
                icon: FileText,
                tone: "violet",
              },
              {
                label: "Outreach sent",
                value: data.messages.filter((m) => m.status === "sent").length,
                icon: Send,
                tone: "amber",
              },
            ].map((s, i) => (
              <div className="pipeline-step" key={s.label}>
                <span className={`pipeline-step-icon ${s.tone}`}>
                  <s.icon size={17} />
                </span>
                <span>{s.label}</span>
                <strong>{s.value}</strong>
                {i < 3 && <i />}
              </div>
            ))}
          </div>
          <div className="reply-block">
            <span className="reply-icon">
              <CheckCheck size={18} />
            </span>
            <div>
              <strong>
                {data.events.filter((e) => e.event_type === "reply").length}{" "}
                replies received
              </strong>
              <span>Good conversations take a thoughtful first step.</span>
            </div>
          </div>
          <Link href="/outreach" className="panel-bottom-link">
            Go to outreach centre <ArrowUpRight size={15} />
          </Link>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title="Recent discovery jobs"
          description="Your searches, sources, and progress in one place."
          action={
            <Link href="/discovery" className="text-link">
              View all jobs <ArrowUpRight size={14} />
            </Link>
          }
        >
          {data.jobs.length ? (
            <div className="recent-jobs">
              {data.jobs.slice(0, 3).map((j) => (
                <Link href="/discovery" key={j.id}>
                  <span className="job-icon">
                    <Compass size={18} />
                  </span>
                  <div>
                    <strong>
                      {j.category} in {j.city}
                    </strong>
                    <small>
                      {j.country} · OpenStreetMap · {formatDate(j.created_at)}
                    </small>
                  </div>
                  <Badge
                    tone={
                      j.status === "completed"
                        ? "green"
                        : j.status === "failed"
                          ? "red"
                          : "blue"
                    }
                  >
                    {j.status}
                  </Badge>
                  <ArrowRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="jobs-empty">
              <div className="empty-search-art">
                <div />
                <Compass size={25} />
                <span>+</span>
              </div>
              <div>
                <h3>A fresh start for your pipeline</h3>
                <p>
                  Choose a city, find your niche, and let your first discovery
                  begin.
                </p>
                <Link href="/discovery" className="text-link">
                  Create a discovery job <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}
        </Panel>
        <Panel
          title="Evidence & sources"
          action={<ShieldCheck size={17} className="muted" />}
        >
          <div className="evidence-summary">
            <div
              className="confidence-ring"
              style={
                {
                  "--progress": `${leads.length ? (verified / leads.length) * 100 : 0}%`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {leads.length
                    ? Math.round((verified / leads.length) * 100)
                    : 0}
                  <span>%</span>
                </strong>
                <small>verified active</small>
              </div>
            </div>
            <div className="source-summary">
              <div>
                <span className="tiny-dot blue" />
                OpenStreetMap
                <strong>
                  {leads.filter((b) => b.provider === "openstreetmap").length}
                </strong>
              </div>
              <div>
                <span className="tiny-dot green" />
                High confidence
                <strong>
                  {leads.filter((b) => b.website_confidence >= 85).length}
                </strong>
              </div>
              <div>
                <span className="tiny-dot amber" />
                Needs review<strong>{awaiting}</strong>
              </div>
            </div>
          </div>
          <div className="evidence-footnote">
            Activity and website confidence are assessed independently.
          </div>
        </Panel>
      </div>
      <div className="thoughtful-strip">
        <span className="thoughtful-icon">
          <Sparkles size={18} />
        </span>
        <div>
          <strong>
            A good opportunity deserves a thoughtful introduction.
          </strong>
          <span>
            Turn verified business facts into a personalised website concept.
          </span>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/studio">
            Explore website studio <ArrowUpRight size={14} />
          </Link>
        </Button>
      </div>
    </>
  );
}
