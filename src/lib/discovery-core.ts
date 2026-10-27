// Portable source adapter: native Web APIs only, suitable for Node and Supabase Edge.
// All provider responses are untrusted and bounded before parsing; no business URL is fetched.
import type { SearchInput, DiscoveredBusiness } from "./discovery";

export function normalise(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

async function sourceFingerprint(name: string, location: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalise(name)}|${normalise(location)}`),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
type Element = {
  id: number;
  type: "node" | "way" | "relation";
  timestamp?: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseProviderPayload(value: unknown): {
  remark?: string;
  elements: Element[];
} {
  const invalid = () => {
    throw new Error("Invalid bounded OpenStreetMap response.");
  };
  if (
    !object(value) ||
    !Array.isArray(value.elements) ||
    value.elements.length > 1000
  )
    return invalid();
  if (value.remark !== undefined && typeof value.remark !== "string")
    return invalid();
  const elements: Element[] = [];
  for (const raw of value.elements) {
    if (
      !object(raw) ||
      typeof raw.id !== "number" ||
      !Number.isSafeInteger(raw.id) ||
      raw.id < 1 ||
      !["node", "way", "relation"].includes(String(raw.type))
    )
      return invalid();
    if (raw.timestamp !== undefined && typeof raw.timestamp !== "string")
      return invalid();
    for (const key of ["lat", "lon"])
      if (
        raw[key] !== undefined &&
        (typeof raw[key] !== "number" || !Number.isFinite(raw[key]))
      )
        return invalid();
    if (
      raw.center !== undefined &&
      (!object(raw.center) ||
        typeof raw.center.lat !== "number" ||
        typeof raw.center.lon !== "number" ||
        !Number.isFinite(raw.center.lat) ||
        !Number.isFinite(raw.center.lon))
    )
      return invalid();
    if (
      raw.tags !== undefined &&
      (!object(raw.tags) ||
        Object.values(raw.tags).some(
          (v) => typeof v !== "string" || v.length > 5000,
        ))
    )
      return invalid();
    elements.push(raw as Element);
  }
  return { remark: value.remark as string | undefined, elements };
}
// Cloud protocol validation is deliberately independent of caller input. The
// app still uses Zod for user actions; these portable checks fail closed on a malformed DB job.
export function parseCloudSearch(value: unknown): SearchInput {
  const invalid = () => {
    throw new Error("Invalid bounded discovery job.");
  };
  if (!object(value)) return invalid();
  const str = (key: string, max: number, optional = false) => {
    const v = value[key] ?? (optional ? "" : undefined);
    if (
      typeof v !== "string" ||
      v.trim().length > max ||
      (!optional && !v.trim())
    )
      return invalid();
    return v.trim();
  };
  if (
    typeof value.category !== "string" ||
    !Object.hasOwn(categoryTag, value.category) ||
    typeof value.max_results !== "number" ||
    !Number.isInteger(value.max_results) ||
    value.max_results < 1 ||
    value.max_results > 100 ||
    !object(value.requirements) ||
    typeof value.requirements.public_contact !== "boolean" ||
    typeof value.requirements.website_review !== "boolean"
  )
    return invalid();
  return {
    country: str("country", 80),
    city: str("city", 100),
    category: value.category as SearchInput["category"],
    keywords: str("keywords", 120, true),
    service_area: str("service_area", 150, true),
    max_results: value.max_results,
    requirements: {
      public_contact: value.requirements.public_contact,
      website_review: value.requirements.website_review,
    },
  };
}

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

export function overpassFailureMessage(status: number) {
  const prefix = `OpenStreetMap provider returned HTTP ${status}.`;
  if (status === 406)
    return `${prefix} The endpoint rejected this request; automatic retries are paused pending operator review of provider policy/configuration.`;
  if (status === 429)
    return `${prefix} The provider rate limited this request; the worker will use bounded backoff.`;
  if ([400, 401, 403, 404, 405, 410, 422].includes(status))
    return `${prefix} The endpoint rejected this request; automatic retries are paused pending operator review of provider policy/configuration.`;
  return `${prefix} The provider did not complete the request; retries are bounded and never treated as an empty successful search.`;
}

export async function discoverOpenStreetMap(
  input: SearchInput,
  endpoint?: string,
  signal?: AbortSignal,
): Promise<DiscoveredBusiness[]> {
  if (!endpoint)
    throw new Error("No Overpass endpoint configured. No source was queried.");
  const url = new URL(endpoint);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Invalid Overpass endpoint.");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      // State the narrow response type and an identifiable product URL. This
      // lets an endpoint apply its published policy deliberately; it is not a
      // substitute for policy review, rate-limit handling, or authentication.
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent":
        "ProspectAIStudio/1.1 (+https://prospectaistudio.vercel.app/responsible-use)",
    },
    body: new URLSearchParams({ data: overpassQuery(input) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(overpassFailureMessage(res.status));
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
  const parsed = parseProviderPayload(JSON.parse(body));
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
      provider: "openstreetmap",
      fingerprint: await sourceFingerprint(t.name, location),
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
