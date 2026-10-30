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
export function extractPathConfigured() {
  return (process.env.OSM_EXTRACT_PATH || "").trim();
}
/** The snapshot lives in the workspace database, so any runtime can use it. */
export function snapshotEnabled() {
  return process.env.OSM_SNAPSHOT === "1";
}
/** True when at least one real source can serve a search. */
export function discoverySourceConfigured() {
  return Boolean(
    process.env.OVERPASS_URL || extractPathConfigured() || snapshotEnabled(),
  );
}
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
/**
 * True when the only usable source is a file on this machine, so no hosted
 * scheduler could ever run the job and a local worker must.
 */
export function localSourceOnly() {
  return Boolean(extractPathConfigured()) && !snapshotEnabled();
}
/**
 * Reads a public country .osm.pbf snapshot instead of an Overpass endpoint.
 * Same OSM database and row shape, but no outbound request and no key, so an
 * egress block cannot stop it. Only usable by a worker that can read a file.
 */
export class StaticExtractProvider implements BusinessProvider {
  id = "openstreetmap";
  async discover(input: SearchInput, signal?: AbortSignal) {
    const { discoverStaticExtract } = await import("./static-extract");
    const radius = Number(process.env.OSM_EXTRACT_RADIUS_KM || "");
    return discoverStaticExtract(input, extractPathConfigured(), {
      radiusKm: Number.isFinite(radius) && radius > 0 ? radius : undefined,
      signal,
    });
  }
}
/**
 * Answers the search from the OpenStreetMap snapshot already stored in the
 * workspace database. No outbound provider request, so an egress block cannot
 * stop it, and it needs no file, so it is the only snapshot form that runs on
 * serverless hosting.
 */
export class SnapshotProvider implements BusinessProvider {
  id = "openstreetmap";
  async discover(input: SearchInput, signal?: AbortSignal) {
    const { discoverOsmSnapshot } = await import("./discovery-core");
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error(
        "Snapshot mode needs the workspace database and the server-only worker key. No source was queried.",
      );
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return discoverOsmSnapshot(
      input,
      (name, args) => db.rpc(name, args),
      signal,
    );
  }
}
export function getProvider(id: string): BusinessProvider {
  if (id === "openstreetmap") {
    if (snapshotEnabled()) return new SnapshotProvider();
    return extractPathConfigured()
      ? new StaticExtractProvider()
      : new OpenStreetMapProvider();
  }
  throw new Error(`Provider ${id} is not supported.`);
}
