import type { Metadata } from "next";

// Deliberate canonical production origin. Never derive canonical URLs from an
// untrusted request Host header or a temporary preview/deployment hostname.
export const SITE_ORIGIN = "https://prospectaistudio.vercel.app";
export const SITE_NAME = "ProspectAI";
export const SITE_DESCRIPTION =
  "Discover businesses, review public evidence, and prepare thoughtful website proposals. Real sources. Human review. Draft-only outreach.";
export const SOCIAL_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "ProspectAI — Find the overlooked. See the opportunity. Evidence-first business research.",
};
export const PUBLIC_PATHS = ["/", "/privacy", "/responsible-use"] as const;
export const PRIVATE_PATHS = [
  "/overview",
  "/discovery",
  "/leads",
  "/verification",
  "/studio",
  "/outreach",
  "/settings",
  "/sign-in",
] as const;
export const PRIVATE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
};

export function publicMetadata(
  path: (typeof PUBLIC_PATHS)[number],
  title: string,
  description: string,
): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: new URL(path, SITE_ORIGIN).href },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: SITE_NAME,
      url: new URL(path, SITE_ORIGIN).href,
      locale: "en_US",
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SOCIAL_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}
