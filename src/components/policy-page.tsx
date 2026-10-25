import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Orbit } from "lucide-react";

export function PolicyPage({
  title,
  introduction,
  children,
}: {
  title: string;
  introduction: string;
  children: React.ReactNode;
}) {
  return (
    <div className="policy-page">
      <a className="skip-link" href="#policy-content">
        Skip to content
      </a>
      <header className="policy-header">
        <Link href="/" className="brand" aria-label="ProspectAI home">
          <span className="brand-symbol">
            <Orbit size={25} />
          </span>
          Prospect<span className="brand-ai">AI</span>.
        </Link>
        <nav aria-label="Policy navigation">
          <Link href="/privacy">Privacy</Link>
          <Link href="/responsible-use">Responsible use</Link>
          <Link href="/sign-in">
            Sign in <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="policy-content" className="policy-main">
        <Link href="/" className="policy-back">
          <ArrowLeft size={16} aria-hidden="true" /> Back to ProspectAI
        </Link>
        <div className="policy-intro">
          <p className="eyebrow">CLEAR EXPECTATIONS. RESPONSIBLE RESEARCH.</p>
          <h1>{title}</h1>
          <p>{introduction}</p>
          <p className="policy-date">
            Last updated <time dateTime="2026-10-25">25 October 2026</time>
          </p>
        </div>
        <article className="policy-body">{children}</article>
      </main>
      <footer className="policy-footer">
        <span>ProspectAI · Evidence over assumptions.</span>
        <nav aria-label="Policy footer">
          <Link href="/privacy">Privacy &amp; data handling</Link>
          <Link href="/responsible-use">Responsible use</Link>
          <Link href="/#faq">FAQs</Link>
        </nav>
      </footer>
    </div>
  );
}
