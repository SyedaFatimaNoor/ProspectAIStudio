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
export function normalise(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
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
const tags = z.record(z.string(), z.string().max(5000));
const resultSchema = z.object({
  remark: z.string().optional(),
  elements: z
    .array(
      z.object({
        id: z.number(),
        type: z.enum(["node", "way", "relation"]),
        timestamp: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        center: z.object({ lat: z.number(), lon: z.number() }).optional(),
        tags: tags.optional(),
      }),
    )
    .max(1000),
});
const categoryTag: Record<string, [string, string]> = {
  cafe: ["amenity", "cafe"],
  restaurant: ["amenity", "restaurant"],
  dentist: ["amenity", "dentist"],
  hairdresser: ["shop", "hairdresser"],
  bakery: ["shop", "bakery"],
  car_repair: ["shop", "car_repair"],
  florist: ["shop", "florist"],
  gym: ["leisure", "fitness_centre"],
};
function regex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function overpassQuery(input: SearchInput) {
  const country = JSON.stringify(`^${regex(input.country)}$`);
  const city = JSON.stringify(`^${regex(input.city)}$`);
  const [key, value] = categoryTag[input.category];
  return `[out:json][timeout:35];(area["admin_level"="2"]["name"~${country},i];area["admin_level"="2"]["name:en"~${country},i];)->.country;(rel(area.country)["name"~${city},i]["boundary"="administrative"];rel(area.country)["name:en"~${city},i]["boundary"="administrative"];)->.city_rel;.city_rel map_to_area->.city;nwr(area.city)["${key}"="${value}"]["name"];out meta center ${Math.min(300, input.max_results * 3)};`;
}
export class OpenStreetMapProvider implements BusinessProvider {
  id = "openstreetmap";
  constructor(private readonly endpoint?: string) {}
  async discover(input: SearchInput, signal?: AbortSignal) {
    const endpoint = this.endpoint ?? process.env.OVERPASS_URL;
    if (!endpoint)
      throw new Error(
        "No Overpass endpoint configured. No source was queried.",
      );
    const url = new URL(endpoint);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Invalid Overpass endpoint.");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ProspectAI/1.0 (bounded public business research)",
      },
      body: new URLSearchParams({ data: overpassQuery(input) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
    });
    if (!res.ok)
      throw new Error(
        `OpenStreetMap provider returned HTTP ${res.status}. Respect endpoint rate limits and retry later.`,
      );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Provider returned no response body.");
    let body = "";
    let length = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 3000000)
          throw new Error(
            "Provider response exceeded the 3 MB safety limit. Narrow your search.",
          );
        body += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const parsed = resultSchema.parse(JSON.parse(body));
    if (parsed.remark)
      throw new Error(
        `Provider returned an incomplete response: ${parsed.remark.slice(0, 300)}`,
      );
    const rows: DiscoveredBusiness[] = [];
    for (const element of parsed.elements) {
      const t = element.tags || {};
      if (!t.name) continue;
      if (
        input.keywords &&
        !t.name.toLowerCase().includes(input.keywords.toLowerCase())
      )
        continue;
      const phone = (t["contact:phone"] || t.phone || "").slice(0, 100) || null;
      const email = (t["contact:email"] || t.email || "").slice(0, 200) || null;
      if (input.requirements.public_contact && !phone && !email) continue;
      const address = [t["addr:street"], t["addr:housenumber"]]
        .filter(Boolean)
        .join(" ");
      const coords = element.center || { lat: element.lat, lon: element.lon };
      const location = `${input.city}|${input.country}|${address || `${coords.lat?.toFixed(3)},${coords.lon?.toFixed(3)}`}`;
      let website = t["contact:website"] || t.website || null;
      if (website && !/^https?:\/\//i.test(website))
        website = `https://${website}`;
      if (website) {
        try {
          const w = new URL(website);
          if (!["http:", "https:"].includes(w.protocol)) website = null;
        } catch {
          website = null;
        }
      }
      rows.push({
        name: t.name.slice(0, 200),
        category: input.category,
        city: input.city,
        country: input.country,
        phone,
        email,
        website,
        source_id: `${element.type}/${element.id}`,
        source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        provider: this.id,
        fingerprint: fingerprint(t.name, location),
        facts: {
          address: address || null,
          coordinates: coords,
          last_source_edit: element.timestamp || null,
          attribution: "© OpenStreetMap contributors, ODbL",
          observed_at: new Date().toISOString(),
          website_link: website,
          activity_note:
            "Listing edits are not evidence of current business operation.",
        },
      });
      if (rows.length >= input.max_results) break;
    }
    return rows;
  }
}
export function getProvider(id: string): BusinessProvider {
  if (id === "openstreetmap") return new OpenStreetMapProvider();
  throw new Error(`Provider ${id} is not supported.`);
}
