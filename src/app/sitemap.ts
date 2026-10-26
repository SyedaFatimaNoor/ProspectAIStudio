import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_ORIGIN } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Only canonical, indexable public pages. Do not invent lastModified dates
  // or expose workspace/user records, auth URLs, or the /home alias.
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, SITE_ORIGIN).href }));
}
