"use client";
import { useState } from "react";
import {
  ShieldCheck,
  Clock3,
  Globe2,
  Search,
  ArrowRight,
  CheckCircle2,
  TriangleAlert,
  RefreshCw,
  FileSearch,
  ExternalLink,
} from "lucide-react";
import {
  PageHeading,
  Panel,
  Badge,
  EmptyState,
  Notice,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { LeadDetail } from "@/components/lead-detail";
import { useWorkspace } from "@/components/workspace-provider";
export default function Verification() {
  const { data, action, notify, refresh } = useWorkspace();
  const [tab, setTab] = useState("review");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const leads = data.businesses.filter(
    (b) =>
      tab === "all" ||
      (tab === "review" &&
        [
          "Unverified",
          "Manual review required",
          "Verification failed",
        ].includes(b.verification_status)) ||
      (tab === "verified" && b.activity_status === "verified_active") ||
      (tab === "website" && b.website_status === "website_found"),
  );
  async function verify(id: string) {
    setBusy(id);
    try {
      await action("verify", { business_id: id });
      notify(
        "Evidence review queued. The worker will record findings and timestamps.",
      );
    } catch {
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="CONFIDENCE, WITH CONTEXT"
        title="Verification centre"
        description="Look beyond the listing. Understand the business, the evidence, and the uncertainty."
      >
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Refresh evidence
        </Button>
      </PageHeading>
      <div className="verification-principle">
        <div className="principle-icon">
          <ShieldCheck size={27} />
        </div>
        <div>
          <h2>Two questions. Two independent assessments.</h2>
          <p>
            Is the business currently active? Does it have an official website?
            One answer never proves the other.
          </p>
        </div>
        <span className="principle-badge">EVIDENCE FIRST</span>
      </div>
      <div className="verification-metrics">
        {[
          {
            icon: Clock3,
            label: "Awaiting review",
            value: data.businesses.filter((b) =>
              ["Unverified", "Manual review required"].includes(
                b.verification_status,
              ),
            ).length,
            tone: "amber",
          },
          {
            icon: ShieldCheck,
            label: "Verified active",
            value: data.businesses.filter(
              (b) => b.activity_status === "verified_active",
            ).length,
            tone: "green",
          },
          {
            icon: Globe2,
            label: "Website found",
            value: data.businesses.filter(
              (b) => b.website_status === "website_found",
            ).length,
            tone: "blue",
          },
          {
            icon: FileSearch,
            label: "Verification runs",
            value: data.runs.length,
            tone: "violet",
          },
        ].map((s) => (
          <div key={s.label}>
            <span className={`summary-icon ${s.tone}`}>
              <s.icon size={20} />
            </span>
            <span>
              {s.label}
              <strong>{s.value}</strong>
            </span>
          </div>
        ))}
      </div>
      <div className="verification-layout">
        <Panel
          title="Evidence review queue"
          description="Review every conclusion alongside its supporting sources."
        >
          <div className="tabs padded-tabs">
            {[
              ["review", "Needs review"],
              ["verified", "Verified active"],
              ["website", "Website found"],
              ["all", "All businesses"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={tab === v ? "active" : ""}
              >
                {l}
              </button>
            ))}
          </div>
          {!leads.length ? (
            <EmptyState
              icon={FileSearch}
              title="Good evidence takes the guesswork out"
              description="Discover businesses first. Then review their listing, contact provenance, and independent website checks here."
              action="Discover businesses"
              href="/discovery"
            />
          ) : (
            <div className="review-list">
              {leads.map((b) => (
                <div className="review-item" key={b.id}>
                  <div className="business-avatar">
                    {b.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <button
                      className="plain-title"
                      onClick={() => setDetail(b.id)}
                    >
                      {b.name}
                    </button>
                    <p>
                      {b.city}, {b.country} · {b.category}
                    </p>
                    <Badge tone="amber">{b.verification_status}</Badge>
                  </div>
                  <div className="review-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDetail(b.id)}
                    >
                      View evidence
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        busy === b.id ||
                        data.runs.some(
                          (r) =>
                            r.business_id === b.id &&
                            ["queued", "running"].includes(r.status),
                        )
                      }
                      onClick={() => void verify(b.id)}
                    >
                      <ShieldCheck size={14} />
                      Verify
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <aside>
          <Panel title="What we look for">
            <div className="evidence-checklist">
              {[
                [
                  "Business identity",
                  "Consistent business name, location, and public source identifiers.",
                ],
                [
                  "Current activity",
                  "Recent permitted public evidence. A listing alone is insufficient.",
                ],
                [
                  "Official website",
                  "Linked domains, safe redirect checks, and identity signals.",
                ],
                [
                  "Honest uncertainty",
                  "Blocked pages, missing links, and timeouts go to manual review.",
                ],
              ].map(([t, d]) => (
                <div key={t}>
                  <CheckCircle2 size={17} />
                  <section>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </section>
                </div>
              ))}
            </div>
          </Panel>
          <Notice>
            OpenStreetMap alone cannot establish website absence or current
            operation with high confidence. Additional research is required.
          </Notice>
        </aside>
      </div>
      <LeadDetail
        lead={data.businesses.find((b) => b.id === detail) || null}
        onClose={() => setDetail(null)}
      />
    </>
  );
}
