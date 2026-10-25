"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Orbit,
  LayoutDashboard,
  Compass,
  Building2,
  ShieldCheck,
  WandSparkles,
  Send,
  Settings2,
  ChevronDown,
  ArrowUpRight,
  PanelLeftClose,
  Menu,
  Search,
  Command,
  HelpCircle,
  Plus,
  LogIn,
  ArrowRight,
  X,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Notice } from "./shared";
const nav = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/discovery", label: "Discover businesses", icon: Compass },
  { href: "/leads", label: "Leads explorer", icon: Building2 },
  { href: "/verification", label: "Verification centre", icon: ShieldCheck },
  { href: "/studio", label: "Website studio", icon: WandSparkles },
  { href: "/outreach", label: "Outreach centre", icon: Send },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState(false);
  const label =
    nav.find((n) => path.startsWith(n.href))?.label ||
    "Settings & integrations";
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <Orbit size={25} />
          </span>
          Prospect<span className="brand-ai">AI</span>
          <span className="brand-period">.</span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => router.push(data.user ? "/settings" : "/sign-in")}
        >
          <span className="workspace-avatar">
            P<span />
          </span>
          <span>
            <strong>{data.user ? "My workspace" : "Your workspace"}</strong>
            <small>
              {data.user ? "Personal workspace" : "Preview · read-only"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setMobile(false)}
              className={`nav-item ${path.startsWith(n.href) ? "active" : ""}`}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.href === "/leads" && (
                <span className="nav-count">{data.businesses.length}</span>
              )}
              {n.href === "/studio" && <span className="new-pill">AI</span>}
            </Link>
          ))}
        </nav>
        <div className="nav-section-label tools-label">MANAGE</div>
        <Link
          href="/settings"
          className={`nav-item ${path === "/settings" ? "active" : ""}`}
          onClick={() => setMobile(false)}
        >
          <Settings2 size={18} />
          <span>Settings & integrations</span>
        </Link>
        <button className="nav-item" onClick={() => setHelp(true)}>
          <HelpCircle size={18} />
          <span>Help & resources</span>
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-orbit">
              <ShieldCheck size={19} />
            </span>
            <strong>Better leads. Real evidence.</strong>
            <p>
              Built for thoughtful outreach,
              <br />
              not another spam campaign.
            </p>
            <Link href="/#trust">
              Our approach <ArrowUpRight size={13} />
            </Link>
          </div>
          <button
            className="profile"
            onClick={() => router.push(data.user ? "/settings" : "/sign-in")}
          >
            <span className="profile-avatar">
              {data.user?.email?.[0]?.toUpperCase() || "Y"}
            </span>
            <span>
              <strong>
                {data.user?.display_name ||
                  data.user?.email?.split("@")[0] ||
                  "Your account"}
              </strong>
              <small>
                {data.user ? "Workspace member" : "Sign in to get started"}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <PanelLeftClose size={16} className="desktop-only" />
            <span className="breadcrumb-divider" />
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              aria-label="Quick search"
              className="search-trigger"
              onClick={() => setSearch(true)}
            >
              <Search size={15} />
              <span>Quick search</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-separator" />
            <Link href="/privacy" className="system-status">
              <span />
              Privacy first
            </Link>
            <button
              className="top-avatar"
              onClick={() => router.push("/sign-in")}
              aria-label="Your account"
            >
              {data.user?.email?.[0]?.toUpperCase() || "Y"}
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {data.windowed && (
            <div className="window-notice">
              <Notice>
                Large workspace: this view shows up to 1,000 recent records per
                section. Metrics, filters, and exports reflect this loaded
                window, not all-time totals.
              </Notice>
            </div>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <span>
            <span className="status-dot" />
            Evidence over assumptions.
          </span>
          <span>
            Made for meaningful connections{" "}
            <span className="footer-star">✳</span>
          </span>
        </footer>
      </div>
      <Dialog
        open={search}
        onOpenChange={setSearch}
        title="Search your workspace"
        description="Find a page or a discovered business."
      >
        <div className="search-field">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and businesses…"
          />
        </div>
        <div className="command-results">
          {nav
            .filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
            .map((n) => (
              <Link onClick={() => setSearch(false)} href={n.href} key={n.href}>
                <n.icon size={18} />
                {n.label}
                <ArrowRight size={16} />
              </Link>
            ))}
          {data.businesses
            .filter(
              (b) =>
                query && b.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((b) => (
              <Link
                key={b.id}
                href={`/leads?lead=${b.id}`}
                onClick={() => setSearch(false)}
              >
                <Building2 size={18} />
                {b.name}
                <ArrowRight size={16} />
              </Link>
            ))}
        </div>
      </Dialog>
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title="A little guidance, a better workflow"
        description="ProspectAI keeps discovery, evidence, and outreach separate."
      >
        <div className="help-list">
          {[
            [
              "1",
              "Discover",
              "Choose a location and category. A configured provider queries real public business records.",
            ],
            [
              "2",
              "Verify",
              "Review evidence of activity separately from website status. Missing links are not proof.",
            ],
            [
              "3",
              "Create & connect",
              "Save a tailored proposal and prepare an outreach draft. Sending is disabled by default.",
            ],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span>{n}</span>
              <section>
                <h3>{t}</h3>
                <p>{d}</p>
              </section>
            </div>
          ))}
        </div>
        <Button asChild variant="outline">
          <Link href="/settings">
            Configure integrations <ArrowRight size={15} />
          </Link>
        </Button>
      </Dialog>
    </div>
  );
}
