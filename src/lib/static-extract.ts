import { createReadStream, existsSync } from "node:fs";
import { categoryTag, normalise } from "./discovery-core";
import { fingerprint } from "./discovery";
import type { DiscoveredBusiness, SearchInput } from "./discovery";

export type Item = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  refs?: number[];
  tags?: Record<string, string>;
  info?: { timestamp?: number };
};

// Place ranks used to pick the tightest match for a city name.
export const placeRank: Record<string, number> = {
  city: 4,
  town: 3,
  suburb: 2,
  hamlet: 1,
  village: 1,
  locality: 0,
};

export type Center = {
  lat: number;
  lon: number;
  place?: string;
  rank: number;
};

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function streamItems(
  filePath: string,
  onItem: (item: Item) => void,
): Promise<void> {
  return import("osm-pbf-parser").then(
    ({ default: osmParser }) =>
      new Promise<void>((resolve, reject) => {
        const parser = (osmParser as unknown as (o: object) => NodeJS.ReadWriteStream)(
          { "skip-comments": true },
        );
        parser.on("error", reject);
        // The library emits one array per string feature: never assume a single item.
        parser.on("data", (raw: unknown) => {
          for (const item of (Array.isArray(raw) ? raw : [raw]) as Item[]) {
            if (item && item.type) onItem(item);
          }
        });
        parser.on("end", () => resolve());
        createReadStream(filePath).pipe(parser as NodeJS.WritableStream);
      }),
  );
}

function nameMatches(tags: Record<string, string> | undefined, want: string) {
  if (!tags) return false;
  const target = normalise(want);
  return [tags.name, tags["name:en"]].some(
    (value) => value && normalise(value) === target,
  );
}

/**
 * A static extract is a snapshot, so an unknown city must fail loudly. Returning
 * zero rows here would be indistinguishable from a genuinely empty neighbourhood.
 */
export async function discoverStaticExtract(
  input: SearchInput,
  filePath: string,
  options: { radiusKm?: number; signal?: AbortSignal } = {},
): Promise<DiscoveredBusiness[]> {
  if (!filePath)
    throw new Error(
      "No local OpenStreetMap extract configured. No source was queried.",
    );
  if (!existsSync(filePath))
    throw new Error(
      `Local OpenStreetMap extract is missing at ${filePath}. Download the country extract first. No source was queried.`,
    );
  const [tagKey, tagValue] = categoryTag[input.category];
  const radiusKm = options.radiusKm ?? 25;

  const placeMatches: Center[] = [];
  const candidateNodes: Item[] = [];
  const candidateWays: Item[] = [];
  const neededRefs = new Set<number>();

  await streamItems(filePath, (item) => {
    if (options.signal?.aborted) throw new Error("Search cancelled.");
    if (item.type === "node") {
      const tags = item.tags;
      const place = tags?.place;
      if (
        place &&
        nameMatches(tags, input.city) &&
        item.lat != null &&
        item.lon != null
      ) {
        placeMatches.push({
          lat: item.lat,
          lon: item.lon,
          place,
          rank: placeRank[place] ?? -1,
        });
      } else if (
        tags?.[tagKey] === tagValue &&
        tags.name &&
        item.lat != null &&
        item.lon != null
      ) {
        candidateNodes.push(item);
      }
    } else if (item.type === "way") {
      const tags = item.tags;
      if (tags?.[tagKey] === tagValue && tags.name) {
        candidateWays.push(item);
        for (const ref of item.refs || []) neededRefs.add(ref);
      }
    }
  });

  const center = placeMatches.sort((a, b) => b.rank - a.rank)[0];
  if (!center)
    throw new Error(
      `"${input.city}" was not found in the local extract, so no search could be scoped to it. Check the spelling used in OpenStreetMap, or download the extract for ${input.country}. No results were produced.`,
    );

  const origin: Center = center;
  const located: { item: Item; lat: number; lon: number; kind: string }[] = [];
  for (const item of candidateNodes) {
    const distance = haversineKm(origin, { lat: item.lat!, lon: item.lon! });
    if (distance <= radiusKm)
      located.push({ item, lat: item.lat!, lon: item.lon!, kind: "node" });
  }

  if (neededRefs.size > 0) {
    const coords = new Map<number, [number, number]>();
    await streamItems(filePath, (item) => {
      if (
        item.type === "node" &&
        item.lat != null &&
        item.lon != null &&
        neededRefs.has(item.id)
      )
        coords.set(item.id, [item.lat, item.lon]);
    });
    for (const way of candidateWays) {
      let lat = 0;
      let lon = 0;
      let count = 0;
      let inside = false;
      for (const ref of way.refs || []) {
        const c = coords.get(ref);
        if (!c) continue;
        lat += c[0];
        lon += c[1];
        count++;
        if (haversineKm(origin, { lat: c[0], lon: c[1] }) <= radiusKm) inside = true;
      }
      if (!inside || count === 0) continue;
      located.push({ item: way, lat: lat / count, lon: lon / count, kind: "way" });
    }
  }

  located.sort(
    (a, b) => haversineKm(origin, a) - haversineKm(origin, b),
  );

  const rows: DiscoveredBusiness[] = [];
  for (const entry of located) {
    const t = entry.item.tags || {};
    if (
      input.keywords &&
      !t.name.toLowerCase().includes(input.keywords.toLowerCase())
    )
      continue;
    const phone = (t["contact:phone"] || t.phone || "").slice(0, 100) || null;
    const email = (t["contact:email"] || t.email || "").slice(0, 200) || null;
    if (input.requirements.public_contact && !phone && !email) continue;
    let website = t["contact:website"] || t.website || null;
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website) {
      try {
        const w = new URL(website);
        if (!["http:", "https:"].includes(w.protocol)) website = null;
      } catch {
        website = null;
      }
    }
    const address = [t["addr:street"], t["addr:housenumber"]]
      .filter(Boolean)
      .join(" ");
    const location = `${input.city}|${input.country}|${address || `${entry.lat.toFixed(3)},${entry.lon.toFixed(3)}`}`;
    const stamp = entry.item.info?.timestamp;
    rows.push({
      name: t.name.slice(0, 200),
      category: input.category,
      city: input.city,
      country: input.country,
      phone,
      email,
      website,
      source_id: `${entry.kind}/${entry.item.id}`,
      source_url: `https://www.openstreetmap.org/${entry.kind}/${entry.item.id}`,
      provider: "openstreetmap",
      fingerprint: fingerprint(t.name, location),
      facts: {
        address: address || null,
        coordinates: { lat: entry.lat, lon: entry.lon },
        last_source_edit: stamp
          ? new Date(stamp).toISOString()
          : null,
        attribution: "© OpenStreetMap contributors, ODbL",
        observed_at: new Date().toISOString(),
        website_link: website,
        source_format: "static .osm.pbf extract (Geofabrik)",
        distance_km: Number(haversineKm(origin, entry).toFixed(2)),
        activity_note:
          "Static extract snapshot. Listing edits are not evidence of current business operation.",
      },
    });
    if (rows.length >= input.max_results) break;
  }
  if (rows.length === 0)
    throw new Error(
      `The local extract has no ${input.category} listings named within ${radiusKm} km of ${input.city}${
        input.requirements.public_contact
          ? " that also publish a phone or email"
          : ""
      }. Narrowed filters can legitimately empty a search, so this job is reported as failed rather than as an empty success.`,
    );
  return rows;
}
