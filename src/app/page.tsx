import { Landing } from "@/components/landing";
import { publicMetadata, SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/site";
export const metadata = publicMetadata(
  "/",
  "ProspectAI — Discover potential. Build connections.",
  SITE_DESCRIPTION,
);
export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ProspectAI",
    url: `${SITE_ORIGIN}/`,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Landing />
    </>
  );
}
