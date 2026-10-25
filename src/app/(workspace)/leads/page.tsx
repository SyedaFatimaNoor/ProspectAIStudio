"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Search,
  SlidersHorizontal,
  Download,
  Plus,
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Columns3,
  MapPin,
  Trash2,
  Check,
  ArrowRight,
  Copy,
  Globe2,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { PageHeading, Badge, EmptyState, Notice } from "@/components/shared";
import { LeadDetail } from "@/components/lead-detail";
import { download, exportBusinesses, formatDate } from "@/lib/utils";
export default function Leads() {
  const { data, action, notify, loading } = useWorkspace();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [columns, setColumns] = useState({
    contact: true,
    confidence: true,
    discovered: true,
  });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDetail(p.get("lead"));
    if (p.get("status")) setStatus(p.get("status")!);
  }, []);
  useEffect(() => setPage(1), [q, status, category]);
  const rows = data.businesses
    .filter(
      (b) =>
        (!q ||
          `${b.name} ${b.city} ${b.country}`
            .toLowerCase()
            .includes(q.toLowerCase())) &&
        (status === "all" ||
          b.website_status === status ||
          b.verification_status === status) &&
        (category === "all" || b.category === category),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "confidence"
          ? b.activity_confidence - a.activity_confidence
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const visible = rows.slice((page - 1) * 10, page * 10);
  const categories = [...new Set(data.businesses.map((b) => b.category))];
  const duplicates = data.businesses.filter(
    (b, i, all) =>
      all.findIndex(
        (x) =>
          x.name.toLowerCase().replace(/\W/g, "") ===
            b.name.toLowerCase().replace(/\W/g, "") &&
          x.city.toLowerCase() === b.city.toLowerCase(),
      ) !== i,
  );
  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }
  async function bulkVerify() {
    try {
      for (const id of selected) await action("verify", { business_id: id });
      setSelected([]);
      notify("Selected leads queued for evidence review.");
    } catch {}
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESEARCH, ORGANISED"
        title="Leads explorer"
        description="Real businesses. Clear provenance. All the context for a better connection."
      >
        <Button
          variant="outline"
          disabled={!rows.length}
          onClick={() =>
            download(
              "prospectai-leads.csv",
              exportBusinesses(
                selected.length
                  ? rows.filter((b) => selected.includes(b.id))
                  : rows,
              ),
              "text/csv",
            )
          }
        >
          <Download size={16} />
          Export CSV
        </Button>
        <Button asChild>
          <Link href="/discovery">
            <Plus size={17} />
            Discover businesses
          </Link>
        </Button>
      </PageHeading>
      <div className="leads-summary">
        <div>
          <span className="summary-icon blue">
            <Building2 size={19} />
          </span>
          <div>
            <strong>{data.businesses.length}</strong>
            <span>Total businesses</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>
              {
                data.businesses.filter(
                  (b) => b.activity_status === "verified_active",
                ).length
              }
            </strong>
            <span>Verified active</span>
          </div>
        </div>
        <div>
          <span className="summary-icon violet">
            <Globe2 size={19} />
          </span>
          <div>
            <strong>
              {
                data.businesses.filter(
                  (b) => b.website_status === "no_website_high_confidence",
                ).length
              }
            </strong>
            <span>No website · high confidence</span>
          </div>
        </div>
        <div>
          <span className="summary-icon amber">
            <Copy size={19} />
          </span>
          <div>
            <strong>{duplicates.length}</strong>
            <span>Possible duplicates</span>
          </div>
        </div>
      </div>
      {duplicates.length > 0 && (
        <Notice>
          {duplicates.length} possible name-and-location matches need review.
          Source identifiers and exact fingerprints are automatically
          deduplicated.
        </Notice>
      )}
      <section className="panel leads-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search leads"
              placeholder="Search business, city, or country…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className="filter-controls">
            <select
              aria-label="Filter by website status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="Unverified">Unverified</option>
              <option value="Manual review required">
                Manual review required
              </option>
              <option value="website_found">Website found</option>
              <option value="no_website_high_confidence">
                No website · high confidence
              </option>
            </select>
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              aria-label="Sort leads"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="name">Business A–Z</option>
              <option value="confidence">Activity confidence</option>
            </select>
            <details className="column-dropdown">
              <summary aria-label="Choose table columns">
                <Columns3 size={16} />
              </summary>
              <div>
                {Object.entries(columns).map(([k, v]) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={v}
                      onChange={() => setColumns((c) => ({ ...c, [k]: !v }))}
                    />
                    {k}
                  </label>
                ))}
              </div>
            </details>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <strong>{selected.length} selected</strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void bulkVerify()}
            >
              <ShieldCheck size={14} />
              Queue verification
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        )}
        <div className="table-scroll">
          <table className="leads-table">
            <thead>
              <tr>
                <th>
                  <input
                    aria-label="Select all visible leads"
                    type="checkbox"
                    checked={
                      !!visible.length &&
                      visible.every((b) => selected.includes(b.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [
                              ...new Set([
                                ...selected,
                                ...visible.map((b) => b.id),
                              ]),
                            ]
                          : selected.filter(
                              (id) => !visible.some((b) => b.id === id),
                            ),
                      )
                    }
                  />
                </th>
                <th>
                  <button
                    onClick={() => setSort(sort === "name" ? "newest" : "name")}
                  >
                    Business <ArrowDownUp size={12} />
                  </button>
                </th>
                <th>Location</th>
                {columns.contact && <th>Public contact</th>}
                <th>Website status</th>
                {columns.confidence && <th>Activity</th>}
                <th>Verification</th>
                {columns.discovered && <th>Discovered</th>}
                <th>Outreach</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr
                  key={b.id}
                  className={selected.includes(b.id) ? "selected" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${b.name}`}
                      checked={selected.includes(b.id)}
                      onChange={() => toggle(b.id)}
                    />
                  </td>
                  <td>
                    <button
                      className="business-cell"
                      onClick={() => setDetail(b.id)}
                    >
                      <span className="business-avatar">
                        {b.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{b.name}</strong>
                        <small>{b.category.replaceAll("_", " ")}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span>{b.city}</span>
                    <small>{b.country}</small>
                  </td>
                  {columns.contact && (
                    <td>
                      <span>{b.email || b.phone || "Not listed"}</span>
                      <small>Public source</small>
                    </td>
                  )}
                  <td>
                    <Badge
                      tone={
                        b.website_status === "website_found"
                          ? "blue"
                          : b.website_status === "no_website_high_confidence"
                            ? "green"
                            : "neutral"
                      }
                    >
                      {b.website_status.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  {columns.confidence && (
                    <td>
                      <div className="table-confidence">
                        <span style={{ width: `${b.activity_confidence}%` }} />
                      </div>
                      <small>
                        {b.activity_confidence}% ·{" "}
                        {b.activity_status.replaceAll("_", " ")}
                      </small>
                    </td>
                  )}
                  <td>
                    <Badge
                      tone={
                        b.verification_status === "Verified active"
                          ? "green"
                          : "amber"
                      }
                    >
                      {b.verification_status}
                    </Badge>
                  </td>
                  {columns.discovered && <td>{formatDate(b.created_at)}</td>}
                  <td>
                    <span className="muted">{b.outreach_status}</span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Open ${b.name}`}
                      onClick={() => setDetail(b.id)}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <EmptyState
            icon={Building2}
            title={
              loading
                ? "Loading your workspace…"
                : q || status !== "all" || category !== "all"
                  ? "No businesses match these filters"
                  : "Your next client could be one discovery away"
            }
            description={
              q || status !== "all" || category !== "all"
                ? "Try a different keyword or broaden your filters."
                : "Discover real businesses from permitted public sources. Every lead keeps its source, history, and evidence."
            }
            action={
              q || status !== "all" ? undefined : "Start your first discovery"
            }
            href="/discovery"
          />
        )}
        <div className="table-footer">
          <span>
            {rows.length
              ? `${(page - 1) * 10 + 1}–${Math.min(page * 10, rows.length)}`
              : "0"}{" "}
            of {rows.length} businesses
          </span>
          <span className="table-footer-note">
            <ShieldCheck size={13} />
            Source-backed. Never fabricated.
          </span>
          <div>
            <Button
              variant="outline"
              size="icon"
              disabled={page === 1}
              aria-label="Previous page"
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={15} />
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= pages}
              aria-label="Next page"
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      </section>
      <LeadDetail
        lead={data.businesses.find((b) => b.id === detail) || null}
        onClose={() => setDetail(null)}
      />
    </>
  );
}
