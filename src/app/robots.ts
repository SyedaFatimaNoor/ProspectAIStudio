import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/auth/"],
      },
    ],
    // Workspace/sign-in pages deliberately remain crawlable so crawlers can
    // observe their noindex metadata, including removal of old indexed URLs.
    // Robots is NOT an authentication/privacy boundary; server auth and RLS are.
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
