export type SnapshotStatus = {
  businesses?: unknown;
  places?: unknown;
  oldest_snapshot?: unknown;
  newest_snapshot?: unknown;
};

export type SnapshotReadiness = {
  ready: boolean;
  businesses: number;
  places: number;
  message: string | null;
};

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/**
 * A configured snapshot flag is not proof that there is a searchable source.
 * Both city/place coverage and business rows are required before a snapshot can
 * receive a discovery job. This helper deliberately evaluates only aggregate
 * metadata and never reads an OSM listing.
 */
export function snapshotReadiness(value: unknown): SnapshotReadiness {
  const status =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as SnapshotStatus)
      : null;
  const businesses = count(status?.businesses);
  const places = count(status?.places);
  if (businesses > 0 && places > 0)
    return { ready: true, businesses, places, message: null };
  return {
    ready: false,
    businesses,
    places,
    message:
      "The OpenStreetMap snapshot is enabled but has no searchable places or businesses. Load a lawful, attributed extract and validate one bounded search while scheduling remains paused. No search was run.",
  };
}
