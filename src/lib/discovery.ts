import { normalise, discoverOpenStreetMap } from "./discovery-core";
import { createHash } from "node:crypto";
import { z } from "zod";
import { jobSchema } from "./validation";
export type SearchInput = z.infer<typeof jobSchema>;
export type DiscoveredBusiness = {
  name: string;
  category: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  source_url: string;
  source_id: string;
  provider: string;
  fingerprint: string;
  facts: Record<string, unknown>;
};
export interface BusinessProvider {
  id: string;
  discover(
    input: SearchInput,
    signal?: AbortSignal,
  ): Promise<DiscoveredBusiness[]>;
}
export const providerDocumentation = {
  openstreetmap: {
    supplies:
      "Names, categories, coordinates, listing tags, and public business contacts when present.",
    credentials: "No API key. Explicit authorised OVERPASS_URL required.",
    limits:
      "No contractual free quota; shared endpoints have resource limits. One request at a time, at least 10 seconds between jobs. 100 listings maximum.",
    terms:
      "Open Database License (ODbL). Attribute © OpenStreetMap contributors. Respect endpoint policy; no bulk harvesting.",
    failures:
      "429 and 5xx are retried up to three times with exponential backoff. Timeouts are errors, never empty successful searches.",
  },
};
export { normalise } from "./discovery-core";
export function fingerprint(name: string, location: string) {
  return createHash("sha256")
    .update(`${normalise(name)}|${normalise(location)}`)
    .digest("hex");
}
export function phoneKey(phone: string | null) {
  return (phone || "").replace(/\D/g, "");
}
export function domainKey(url: string | null) {
  try {
    return new URL(url?.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
export function isDuplicate(
  a: DiscoveredBusiness,
  b: Pick<
    DiscoveredBusiness,
    | "source_id"
    | "provider"
    | "fingerprint"
    | "name"
    | "city"
    | "phone"
    | "website"
  >,
) {
  if (a.provider === b.provider && a.source_id === b.source_id) return true;
  if (a.fingerprint === b.fingerprint) return true;
  const sameName = normalise(a.name) === normalise(b.name);
  const phone = phoneKey(a.phone);
  if (phone.length >= 8 && phone === phoneKey(b.phone) && sameName) return true;
  const domain = domainKey(a.website);
  return Boolean(
    domain &&
    domain === domainKey(b.website) &&
    sameName &&
    normalise(a.city) === normalise(b.city),
  );
}
export { overpassQuery } from "./discovery-core";
export class OpenStreetMapProvider implements BusinessProvider {
  id = "openstreetmap";
  constructor(private readonly endpoint?: string) {}
  discover(input: SearchInput, signal?: AbortSignal) {
    return discoverOpenStreetMap(
      input,
      this.endpoint ?? process.env.OVERPASS_URL,
      signal,
    );
  }
}
export function getProvider(id: string): BusinessProvider {
  if (id === "openstreetmap") return new OpenStreetMapProvider();
  throw new Error(`Provider ${id} is not supported.`);
}
