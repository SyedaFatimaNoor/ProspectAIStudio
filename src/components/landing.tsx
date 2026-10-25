"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Orbit,
  ArrowRight,
  ArrowUpRight,
  Compass,
  ShieldCheck,
  Globe2,
  FileText,
  Send,
  Check,
  Plus,
  Menu,
  X,
  Search,
  ExternalLink,
  LockKeyhole,
  Database,
  WandSparkles,
} from "lucide-react";
import { Button } from "./ui/button";
export function Landing() {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-header">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <Orbit size={25} />
          </span>
          Prospect<span className="brand-ai">AI</span>
          <span className="brand-period">.</span>
        </Link>
        <nav className={mobile ? "open" : ""} aria-label="Public navigation">
          <a href="#how">How it works</a>
          <a href="#features">The platform</a>
          <a href="#trust">Our approach</a>
          <a href="#faq">FAQs</a>
        </nav>
        <div className="landing-header-actions">
          <Link href="/sign-in" className="sign-in-link">
            Sign in <ArrowUpRight size={14} />
          </Link>
          <Button asChild size="sm">
            <Link href="/overview">
              Explore workspace
              <ArrowRight size={14} />
            </Link>
          </Button>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle menu"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>
      <main id="main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <a href="#how" className="landing-kicker">
              <span />A BETTER KIND OF BUSINESS DISCOVERY{" "}
              <ArrowUpRight size={13} />
            </a>
            <h1>
              Find the overlooked.
              <br />
              See the <span>opportunity.</span>
            </h1>
            <p>
              Discover businesses that could use a stronger online presence.
              Verify the evidence. Turn a little insight into your next
              meaningful connection.
            </p>
            <div className="landing-hero-buttons">
              <Button asChild>
                <Link href="/discovery">
                  Start discovering <ArrowRight size={17} />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/overview">
                  Take a look inside <ArrowUpRight size={16} />
                </Link>
              </Button>
            </div>
            <div className="landing-benefits">
              <span>
                <Check size={14} />
                Real public sources
              </span>
              <span>
                <Check size={14} />
                Evidence-led verification
              </span>
              <span>
                <Check size={14} />
                No paid AI required
              </span>
            </div>
          </div>
          <div className="global-visual">
            <div className="visual-topline">
              <span className="visual-live">
                <span />A WORLD OF POSSIBILITIES
              </span>
              <span>
                DISCOVERY, WITH DIRECTION <Compass size={13} />
              </span>
            </div>
            <div className="global-map">
              <img
                src="/world.svg"
                alt="Dotted world map representing global business discovery"
              />
              <svg className="global-map-paths" viewBox="0 0 1080 480">
                <path d="M250 160 Q420 -20 560 130 M560 130 Q680 60 740 215 M740 215 Q870 210 900 340 M250 160 Q280 270 360 330 M560 130 Q520 270 580 300" />
                {[
                  [250, 160],
                  [560, 130],
                  [740, 215],
                  [900, 340],
                  [360, 330],
                  [580, 300],
                ].map(([x, y], i) => (
                  <g key={i}>
                    <circle cx={x} cy={y} r="13" className="map-node-halo" />
                    <circle cx={x} cy={y} r="5" />
                  </g>
                ))}
              </svg>
              <div className="floating-search">
                <Search size={17} />
                <span>Your next opportunity, anywhere.</span>
                <span className="floating-search-key">
                  <Compass size={14} />
                </span>
              </div>
              <div className="map-sample-card">
                <div className="sample-card-top">
                  <span className="sample-business-icon">
                    <Globe2 size={20} />
                  </span>
                  <span>
                    <strong>A local business.</strong>
                    <small>A new possibility.</small>
                  </span>
                  <ArrowUpRight size={16} />
                </div>
                <div className="sample-card-divider" />
                <span className="sample-evidence">
                  <ShieldCheck size={14} />
                  Every lead has a source.
                </span>
                <div className="sample-card-lines">
                  <i />
                  <i />
                </div>
                <small className="sample-disclaimer">
                  PRODUCT ILLUSTRATION · NOT A REAL LEAD
                </small>
              </div>
              <div className="map-evidence-tag">
                <span>
                  <ShieldCheck size={15} />
                </span>
                <div>
                  <strong>Less guesswork.</strong>
                  <small>More context.</small>
                </div>
              </div>
            </div>
            <div className="visual-bottomline">
              <span>
                <Globe2 size={14} />
                Local businesses. Global possibilities.
              </span>
              <span>
                RESEARCH BEFORE REACHING OUT <ArrowRight size={14} />
              </span>
            </div>
          </div>
        </section>
        <div className="landing-principles">
          <span>
            Built for the way
            <br />
            <strong>thoughtful agencies work.</strong>
          </span>
          <div>
            <Compass size={22} />
            Discover with purpose
          </div>
          <div>
            <ShieldCheck size={22} />
            Verify before you pitch
          </div>
          <div>
            <WandSparkles size={22} />
            Make it personal
          </div>
          <div>
            <Send size={22} />
            Reach out responsibly
          </div>
        </div>
        <section id="how" className="landing-section how-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                FROM A PLACE ON THE MAP TO A REAL CONVERSATION
              </div>
              <h2>A smarter path to your next client.</h2>
            </div>
            <p>
              Not another list of names.
              <br />A connected workflow, with evidence at every step.
            </p>
          </div>
          <div className="how-grid">
            {[
              {
                n: "01",
                icon: Compass,
                title: "Start with the right businesses.",
                desc: "Choose a city and a category. Query permitted public sources and keep the origin of every discovery.",
                link: "Find your focus",
                href: "/discovery",
              },
              {
                n: "02",
                icon: ShieldCheck,
                title: "Look beyond the listing.",
                desc: "Assess activity and website presence independently. See the evidence, the confidence, and what still needs a human review.",
                link: "Understand verification",
                href: "/verification",
              },
              {
                n: "03",
                icon: WandSparkles,
                title: "Make your introduction count.",
                desc: "Turn supported business facts into an editable website concept and a thoughtful, human-reviewed outreach draft.",
                link: "Explore the studio",
                href: "/studio",
              },
            ].map((s) => (
              <article key={s.n}>
                <div className="how-step-top">
                  <span>
                    <s.icon size={23} />
                  </span>
                  <small>{s.n} /</small>
                </div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <Link href={s.href}>
                  {s.link}
                  <ArrowRight size={15} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section id="features" className="landing-section platform-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">ONE WORKSPACE. THE WHOLE PICTURE.</div>
              <h2>
                Less tab-hopping.
                <br />
                More possibility.
              </h2>
            </div>
            <Button asChild variant="outline">
              <Link href="/overview">
                Explore the workspace <ArrowUpRight size={15} />
              </Link>
            </Button>
          </div>
          <div className="platform-preview">
            <div className="platform-preview-sidebar">
              <span className="preview-brand">
                <Orbit size={21} />
                ProspectAI
              </span>
              {[
                "Overview",
                "Discover businesses",
                "Leads explorer",
                "Verification centre",
                "Website studio",
                "Outreach centre",
              ].map((n, i) => (
                <span key={n} className={i === 2 ? "active" : ""}>
                  {
                    [
                      <Globe2 size={15} key="1" />,
                      <Compass size={15} key="2" />,
                      <Database size={15} key="3" />,
                      <ShieldCheck size={15} key="4" />,
                      <WandSparkles size={15} key="5" />,
                      <Send size={15} key="6" />,
                    ][i]
                  }
                  {n}
                </span>
              ))}
              <small>DESIGN PREVIEW</small>
            </div>
            <div className="platform-preview-main">
              <div className="preview-label">
                <span>ILLUSTRATIVE SAMPLE DATA</span>
                <ShieldCheck size={14} /> Never presented as verified leads
              </div>
              <div className="preview-page-title">
                <div>
                  <h3>Your research. In focus.</h3>
                  <p>
                    Know what you’ve found — and what still needs a closer look.
                  </p>
                </div>
                <span className="preview-button">
                  <Plus size={14} />
                  New discovery
                </span>
              </div>
              <div className="preview-filter">
                <Search size={14} />
                Search your leads
                <span>
                  All categories <ArrowUpRight size={12} />
                </span>
              </div>
              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Public source</th>
                      <th>Website status</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        "Sample coffee shop",
                        "OpenStreetMap",
                        "Not yet assessed",
                      ],
                      [
                        "Sample dental practice",
                        "OpenStreetMap",
                        "Candidate found",
                      ],
                      [
                        "Sample neighbourhood florist",
                        "OpenStreetMap",
                        "Manual review",
                      ],
                    ].map(([n, s, w], i) => (
                      <tr key={n}>
                        <td>
                          <span
                            className={`preview-initial ${["blue", "violet", "green"][i]}`}
                          >
                            {["SC", "SD", "SF"][i]}
                          </span>
                          <span>
                            {n}
                            <small>Fictional example</small>
                          </span>
                        </td>
                        <td>
                          {s}
                          <ExternalLink size={11} />
                        </td>
                        <td>
                          <span className={`preview-status status-${i}`}>
                            {w}
                          </span>
                        </td>
                        <td>
                          <span className="preview-review">
                            <ShieldCheck size={12} />
                            Unverified
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="preview-table-bottom">
                <span>All businesses shown are fictional examples.</span>
                <span>
                  Evidence over assumptions. <ShieldCheck size={12} />
                </span>
              </div>
            </div>
          </div>
          <div className="feature-caption-grid">
            <div>
              <Database size={18} />
              <strong>Provenance that stays with the lead.</strong>
              <p>
                Source links, timestamps, contact origins, and a review history.
              </p>
            </div>
            <div>
              <FileText size={18} />
              <strong>Your ideas. Ready to refine.</strong>
              <p>Editable concepts, proposals, outreach drafts, and exports.</p>
            </div>
            <div>
              <LockKeyhole size={18} />
              <strong>A private space for your pipeline.</strong>
              <p>User-isolated records and server-side protected operations.</p>
            </div>
          </div>
        </section>
        <section id="trust" className="landing-section trust-section">
          <div className="trust-copy">
            <div className="eyebrow">
              BETTER LEADS SHOULDN’T COME AT A COST TO TRUST
            </div>
            <h2>
              Built on evidence.
              <br />
              Grounded in respect.
            </h2>
            <p>
              A business listing is a starting point, not the whole story.
              ProspectAI makes uncertainty visible and puts you in control of
              what happens next.
            </p>
            <Link href="/verification">
              See how verification works
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="trust-points">
            {[
              [
                ShieldCheck,
                "No invented certainty.",
                "Website absence and business activity are assessed separately. Missing links never become automatic proof.",
              ],
              [
                Globe2,
                "Permitted sources. Clear provenance.",
                "No bypassing CAPTCHAs, paywalls, authentication, or platform restrictions. Public data is still handled responsibly.",
              ],
              [
                Send,
                "A human before every hello.",
                "Draft-only outreach, explicit review, suppression records, and respect for consent and applicable law.",
              ],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <div key={String(t)}>
                  <span>
                    <I size={20} />
                  </span>
                  <section>
                    <h3>{String(t)}</h3>
                    <p>{String(d)}</p>
                  </section>
                </div>
              );
            })}
          </div>
        </section>
        <section id="faq" className="landing-section faq-section">
          <div>
            <div className="eyebrow">A FEW THINGS WORTH KNOWING</div>
            <h2>
              Clear answers.
              <br />
              No small print.
            </h2>
            <p>
              Honest expectations make for
              <br />
              better opportunities.
            </p>
          </div>
          <div className="faq-list">
            {[
              [
                "Does ProspectAI guarantee a business has no website?",
                "No. Missing website links are not proof of absence. Each lead keeps separate activity and website assessments, with evidence and confidence explanations. Ambiguous records require manual review.",
              ],
              [
                "Where does the business data come from?",
                "The initial provider uses OpenStreetMap through an explicitly configured Overpass endpoint. Coverage and freshness vary by location. You can add other permitted providers through the server-side provider interface.",
              ],
              [
                "Do I need a paid AI subscription?",
                "No. Discovery, manual review, fact-based concept drafts, and outreach editing work without AI. You can optionally configure a local model through Ollama or another compatible provider.",
              ],
              [
                "Will it automatically message businesses?",
                "No. This release is draft-only. You can save, review, approve, and export drafts, but no messages are sent. Any future provider must follow applicable law, consent requirements, and platform policies.",
              ],
              [
                "Can I use the whole platform straight away?",
                "You can explore every page immediately. Sign in and configure Supabase for persistence. Live discovery additionally requires a permitted Overpass endpoint and the background worker. AI is optional.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={17} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-cta">
          <span className="cta-orbit">
            <Orbit size={34} />
          </span>
          <div>
            <div className="eyebrow">
              THERE’S POTENTIAL IN EVERY NEIGHBOURHOOD
            </div>
            <h2>Let’s find your next opportunity.</h2>
            <p>Start with a real business. Build something meaningful.</p>
          </div>
          <Button asChild>
            <Link href="/discovery">
              Start discovering
              <ArrowRight size={17} />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="landing-footer">
        <div>
          <Link href="/" className="brand">
            <span className="brand-symbol">
              <Orbit size={22} />
            </span>
            Prospect<span className="brand-ai">AI</span>.
          </Link>
          <p>Discover potential. Build real connections.</p>
        </div>
        <nav>
          <Link href="/privacy">Privacy &amp; data handling</Link>
          <Link href="/responsible-use">Responsible use</Link>
          <a href="#faq">FAQs</a>
          <Link href="/settings">Integrations</Link>
          <Link href="/sign-in">
            Sign in <ArrowUpRight size={13} />
          </Link>
        </nav>
        <div className="landing-footer-bottom">
          <span>
            © {new Date().getUTCFullYear()} ProspectAI. Built for thoughtful
            outreach.
          </span>
          <span>
            <ShieldCheck size={13} />
            Evidence over assumptions.
          </span>
        </div>
      </footer>
    </div>
  );
}
