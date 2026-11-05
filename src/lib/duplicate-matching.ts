import { domainKey, phoneKey } from "./discovery";
import { normalise } from "./discovery-core";

export type DuplicateMatchReason =
  | "exact_osm_element_id"
  | "normalized_website_domain"
  | "normalized_phone"
  | "exact_normalized_name_city"
  | "similar_name_nearby_coordinates"
  | "similar_address_category";

export type DuplicateCandidate = {
  provider: string;
  source_id: string;
  name: string;
  city: string;
  category: string;
  phone: string | null;
  website: string | null;
  facts?: Record<string, unknown>;
};

function coordinates(value: DuplicateCandidate) {
  const coords = value.facts?.coordinates;
  if (!coords || typeof coords !== "object") return null;
  const { lat, lon } = coords as { lat?: unknown; lon?: unknown };
  return typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lon === "number" &&
    Number.isFinite(lon)
    ? { lat, lon }
    : null;
}
function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const radians = Math.PI / 180;
  const x =
    (b.lon - a.lon) * radians * Math.cos(((a.lat + b.lat) / 2) * radians);
  const y = (b.lat - a.lat) * radians;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
function similar(a: string, b: string) {
  const left = normalise(a);
  const right = normalise(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return (
    shorter.length >= 5 &&
    longer.includes(shorter) &&
    shorter.length / longer.length >= 0.72
  );
}
function address(value: DuplicateCandidate) {
  const raw = value.facts?.address;
  return typeof raw === "string" ? raw : "";
}

/** Ordered, explainable matching. A match is a review candidate, never permission to merge/delete. */
export function duplicateMatchReason(
  a: DuplicateCandidate,
  b: DuplicateCandidate,
): DuplicateMatchReason | null {
  if (
    a.provider === "openstreetmap" &&
    b.provider === "openstreetmap" &&
    a.source_id &&
    a.source_id === b.source_id
  )
    return "exact_osm_element_id";
  const domain = domainKey(a.website);
  if (domain && domain === domainKey(b.website))
    return "normalized_website_domain";
  const phone = phoneKey(a.phone);
  if (phone.length >= 8 && phone === phoneKey(b.phone))
    return "normalized_phone";
  if (
    normalise(a.name) &&
    normalise(a.name) === normalise(b.name) &&
    normalise(a.city) === normalise(b.city)
  )
    return "exact_normalized_name_city";
  const aCoords = coordinates(a);
  const bCoords = coordinates(b);
  if (
    similar(a.name, b.name) &&
    normalise(a.city) === normalise(b.city) &&
    aCoords &&
    bCoords &&
    distanceMeters(aCoords, bCoords) <= 150
  )
    return "similar_name_nearby_coordinates";
  if (a.category === b.category && similar(address(a), address(b)))
    return "similar_address_category";
  return null;
}
