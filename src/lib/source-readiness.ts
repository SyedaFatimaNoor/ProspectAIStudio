export type SnapshotStatus = {
  businesses?: unknown;
  places?: unknown;
  oldest_snapshot?: unknown;
  newest_snapshot?: unknown;
  import_status?: unknown;
  last_import_error?: unknown;
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
  const importState =
    status?.import_status === undefined
      ? null
      : typeof status.import_status === "string"
        ? status.import_status
        : "unknown";

  // The import-state field is added by the provenance migration. Keep older
  // deployed schemas readable, but once it exists a partial/failed import is
  // never allowed to serve a discovery job, even if its first chunks loaded.
  if (importState && importState !== "ready" && importState !== "empty") {
    const detail =
      typeof status?.last_import_error === "string" && status.last_import_error
        ? ` ${status.last_import_error.slice(0, 180)}`
        : "";
    return {
      ready: false,
      businesses,
      places,
      message: `The OpenStreetMap snapshot import is ${importState}, not ready. Discovery remains blocked until a complete lawful import records its provenance.${detail}`,
    };
  }
  if (!businesses || !places)
    return {
      ready: false,
      businesses,
      places,
      message:
        "The OpenStreetMap snapshot is enabled but has no searchable places or businesses (the snapshot is empty). Load a lawful, attributed extract and validate one bounded search while scheduling remains paused. No search was run.",
    };
  if (importState && importState !== "ready")
    return {
      ready: false,
      businesses,
      places,
      message: `The OpenStreetMap snapshot import is ${importState}, not ready. Discovery remains blocked until a complete lawful import records its provenance.`,
    };
  return { ready: true, businesses, places, message: null };
}
