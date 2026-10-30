import { categoryTag } from "./discovery-core";
import {
  haversineKm,
  placeRank,
  streamItems,
  type Center,
  type Item,
} from "./static-extract";

export type SnapshotPlace = {
  id: number;
  kind: string;
  name: string;
  name_en: string | null;
  place: string;
  country_code: string;
  lat: number;
  lon: number;
  rank: number;
};

export type SnapshotBusiness = {
  id: number;
  kind: string;
  osm_type_id: string;
  category_key: string;
  category_value: string;
  app_category: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  street: string | null;
  housenumber: string | null;
  locality: string | null;
  country_code: string;
  lat: number;
  lon: number;
  place_ids: number[];
  edit_at: string | null;
  snapshot_date: string;
};

// A place contains a business within this radius; a city scope reaches its
// children within this radius. Both are deliberately generous because OSM
// address tags are sparse, and a listing must never leak between cities.
const containKm: Record<number, number> = { 4: 45, 3: 25, 2: 12, 1: 6, 0: 3 };
const scopeKm: Record<number, number> = { 4: 45, 3: 25, 2: 12, 1: 12, 0: 12 };

type Match = { key: string; value: string; app: string };
const categoryList: Match[] = Object.entries(categoryTag).map(
  ([app, [key, value]]) => ({ app, key, value }),
);

function categoryOf(tags: Record<string, string>): Match | null {
  for (const match of categoryList)
    if (tags[match.key] === match.value) return match;
  return null;
}

function tagged(tags: Record<string, string>, key: string, max: number) {
  const value = tags[key];
  return value ? value.slice(0, max) : null;
}

function contact(tags: Record<string, string>, base: string, max: number) {
  return tagged(tags, `contact:${base}`, max) ?? tagged(tags, base, max);
}

/**
 * Assigns each listing the places it may belong to, highest rank first. Bounding
 * boxes prune the distance work before the haversine test.
 */
function placeIdsFor(
  lat: number,
  lon: number,
  places: SnapshotPlace[],
  grid: Map<string, SnapshotPlace[]>,
) {
  const hits: { id: number; rank: number; distance: number }[] = [];
  const maxRadius = containKm[4];
  const cellKeys = new Set<string>();
  for (let dLat = -1; dLat <= 1; dLat++)
    for (let dLon = -1; dLon <= 1; dLon++)
      cellKeys.add(`${Math.floor(lat) + dLat}:${Math.floor(lon) + dLon}`);
  for (const key of cellKeys)
    for (const place of grid.get(key) || []) {
      const radius = containKm[place.rank] ?? containKm[0];
      if (Math.abs(place.lat - lat) > radius / 111) continue;
      if (Math.abs(place.lon - lon) > radius / 90) continue;
      const distance = haversineKm({ lat, lon }, { lat: place.lat, lon: place.lon });
      if (distance <= radius)
        hits.push({ id: place.id, rank: place.rank, distance });
    }
  void maxRadius;
  return hits
    .sort((a, b) => b.rank - a.rank || a.distance - b.distance)
    .slice(0, 40)
    .map((h) => h.id);
}

export async function buildOsmSnapshot(
  filePath: string,
  options: { countryCode: string; snapshotDate: string },
): Promise<{ places: SnapshotPlace[]; businesses: SnapshotBusiness[] }> {
  const places: SnapshotPlace[] = [];
  const nodes: Item[] = [];
  const ways: { item: Item; refs: number[] }[] = [];
  const neededRefs = new Set<number>();

  await streamItems(filePath, (item) => {
    const tags = item.tags;
    if (!tags) return;
    if (item.type === "node") {
      const rank = tags.place ? (placeRank[tags.place] ?? -1) : -1;
      if (rank >= 0 && tags.name && item.lat != null && item.lon != null) {
        places.push({
          id: item.id,
          kind: "node",
          name: tags.name.slice(0, 200),
          name_en: tagged(tags, "name:en", 200),
          place: tags.place.slice(0, 40),
          country_code: options.countryCode,
          lat: item.lat,
          lon: item.lon,
          rank,
        });
        return;
      }
    }
    const match = categoryOf(tags);
    if (!match || !tags.name) return;
    if (item.type === "node" && item.lat != null && item.lon != null) {
      nodes.push(item);
    } else if (item.type === "way" && item.refs?.length) {
      ways.push({ item, refs: item.refs });
      for (const ref of item.refs) neededRefs.add(ref);
    }
  });

  const coords = new Map<number, Center>();
  if (neededRefs.size > 0)
    await streamItems(filePath, (item) => {
      if (
        item.type === "node" &&
        item.lat != null &&
        item.lon != null &&
        neededRefs.has(item.id)
      )
        coords.set(item.id, { lat: item.lat, lon: item.lon, rank: 0 });
    });

  const located: { item: Item; lat: number; lon: number; kind: string }[] = [];
  for (const item of nodes)
    located.push({ item, lat: item.lat!, lon: item.lon!, kind: "node" });
  for (const way of ways) {
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (const ref of way.refs) {
      const c = coords.get(ref);
      if (!c) continue;
      lat += c.lat;
      lon += c.lon;
      count++;
    }
    if (count === 0) continue;
    located.push({
      item: way.item,
      lat: lat / count,
      lon: lon / count,
      kind: "way",
    });
  }

  // Coarse 1-degree grid so scope assignment stays linear on a country extract.
  const grid = new Map<string, SnapshotPlace[]>();
  for (const place of places) {
    const key = `${Math.floor(place.lat)}:${Math.floor(place.lon)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(place);
  }

  const businesses: SnapshotBusiness[] = [];
  for (const entry of located) {
    const tags = entry.item.tags!;
    const match = categoryOf(tags)!;
    const place_ids = placeIdsFor(entry.lat, entry.lon, places, grid);
    if (place_ids.length === 0) continue;
    businesses.push({
      id: entry.item.id,
      kind: entry.kind,
      osm_type_id: `${entry.kind}/${entry.item.id}`,
      category_key: match.key,
      category_value: match.value,
      app_category: match.app,
      name: tags.name.slice(0, 200),
      phone: contact(tags, "phone", 100),
      email: contact(tags, "email", 200),
      website: contact(tags, "website", 300),
      street: tagged(tags, "addr:street", 200),
      housenumber: tagged(tags, "addr:housenumber", 40),
      locality:
        tagged(tags, "addr:city", 120) ??
        tagged(tags, "addr:suburb", 120) ??
        tagged(tags, "addr:district", 120),
      country_code: options.countryCode,
      lat: Number(entry.lat.toFixed(7)),
      lon: Number(entry.lon.toFixed(7)),
      place_ids,
      edit_at: entry.item.info?.timestamp
        ? String(Math.round(entry.item.info.timestamp / 1000))
        : null,
      snapshot_date: options.snapshotDate,
    });
  }
  return { places, businesses };
}

/** Mirrors pa_osm_place_scope() so a snapshot file can be searched offline. */
export function scopeOfCity(
  city: SnapshotPlace,
  places: SnapshotPlace[],
): number[] {
  const radius = scopeKm[city.rank] ?? 12;
  const ids: number[] = [city.id];
  for (const place of places) {
    if (place.id === city.id || place.rank >= city.rank) continue;
    if (haversineKm(city, place) <= radius) ids.push(place.id);
  }
  return ids;
}
