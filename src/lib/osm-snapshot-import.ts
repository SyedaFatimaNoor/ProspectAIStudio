import type { SnapshotBusiness, SnapshotPlace } from "./osm-snapshot";

export const osmSnapshotAttribution =
  "© OpenStreetMap contributors, Open Database License (ODbL)";

export type OsmSnapshotImportSource = {
  sourceName: string;
  sourceUrl: string;
  /** Optional upstream extract publication timestamp, never an inferred value. */
  datasetTimestamp?: string | null;
};

export type OsmSnapshotImportRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

type SnapshotData = {
  places: SnapshotPlace[];
  businesses: SnapshotBusiness[];
};

type ImportOptions = {
  chunkSize?: number;
  onProgress?: (
    operation: "places" | "businesses",
    completed: number,
    total: number,
  ) => void;
};

function fail(message: string): never {
  throw new Error(`Invalid OSM snapshot import: ${message}`);
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function finiteCoordinate(value: unknown, min: number, max: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function osmIdentity(
  value: Pick<SnapshotBusiness, "id" | "kind" | "osm_type_id">,
) {
  if (!positiveInteger(value.id))
    fail("business has an invalid OSM element ID");
  if (!/^(node|way|relation)$/.test(value.kind))
    fail("business has an invalid OSM element type");
  const identity = `${value.kind}/${value.id}`;
  if (value.osm_type_id !== identity)
    fail("business OSM type/ID does not match its source identity");
  return identity;
}

function validateSource(source: OsmSnapshotImportSource) {
  const sourceName = source.sourceName.trim();
  if (!sourceName || sourceName.length > 160)
    fail("source name is required and must be at most 160 characters");

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source.sourceUrl);
  } catch {
    fail("source URL must be a valid HTTPS URL");
  }
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.search ||
    sourceUrl.hash ||
    sourceUrl.toString().length > 1000
  )
    fail("source URL must be an HTTPS URL without credentials, query parameters, or fragments");

  let datasetTimestamp: string | null = null;
  if (source.datasetTimestamp?.trim()) {
    const parsed = new Date(source.datasetTimestamp);
    if (Number.isNaN(parsed.getTime()))
      fail("dataset timestamp must be an ISO-8601 timestamp when supplied");
    datasetTimestamp = parsed.toISOString();
  }
  return { sourceName, sourceUrl: sourceUrl.toString(), datasetTimestamp };
}

/**
 * Validates a locally parsed OSM extract before any RPC starts. Source rows are
 * never invented or silently deduplicated: an ambiguous duplicate is a failed
 * import that an operator must resolve at the source.
 */
export function validateOsmSnapshotImport(
  snapshot: SnapshotData,
  source: OsmSnapshotImportSource,
) {
  const metadata = validateSource(source);
  if (!Array.isArray(snapshot.places) || snapshot.places.length === 0)
    fail("at least one place is required");
  if (!Array.isArray(snapshot.businesses) || snapshot.businesses.length === 0)
    fail("at least one business is required");

  const placeIds = new Set<number>();
  for (const place of snapshot.places) {
    if (!positiveInteger(place.id) || placeIds.has(place.id))
      fail("duplicate or invalid place OSM element ID");
    placeIds.add(place.id);
    if (!/^(node|way|relation)$/.test(place.kind))
      fail("place has an invalid OSM element type");
    if (!place.name.trim() || place.name.length > 200)
      fail("place has an invalid name");
    if (
      !finiteCoordinate(place.lat, -90, 90) ||
      !finiteCoordinate(place.lon, -180, 180)
    )
      fail("place has an invalid coordinate");
  }

  const businessSourceIds = new Set<string>();
  for (const business of snapshot.businesses) {
    const identity = osmIdentity(business);
    if (businessSourceIds.has(identity))
      fail(`duplicate OSM element ID ${identity}`);
    businessSourceIds.add(identity);
    if (!business.name.trim() || business.name.length > 200)
      fail("business has an invalid name");
    if (
      !finiteCoordinate(business.lat, -90, 90) ||
      !finiteCoordinate(business.lon, -180, 180)
    )
      fail("business has an invalid coordinate");
    if (
      !Array.isArray(business.place_ids) ||
      business.place_ids.length === 0 ||
      business.place_ids.some((id) => !placeIds.has(id))
    )
      fail(`business ${identity} is not assigned to a loaded place`);
  }

  return metadata;
}

async function rpc(
  call: OsmSnapshotImportRpc,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await call(name, args);
  if (result.error)
    throw new Error(
      `OSM snapshot import ${name} failed: ${result.error.message}`,
    );
  return result.data;
}

function importError(cause: unknown) {
  return (cause instanceof Error ? cause.message : "Unknown import failure")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

/**
 * Loads a locally parsed extract through service-only RPCs. Every source row is
 * upserted by its typed OSM identity; completion metadata is committed only
 * after all chunks succeed. A failure marks the snapshot unavailable so the
 * discovery worker cannot use a partial import.
 */
export async function importOsmSnapshot(
  snapshot: SnapshotData,
  source: OsmSnapshotImportSource,
  call: OsmSnapshotImportRpc,
  options: ImportOptions = {},
) {
  const metadata = validateOsmSnapshotImport(snapshot, source);
  const chunkSize = options.chunkSize ?? 2_000;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 50_000)
    throw new Error("Invalid OSM snapshot import chunk size.");

  await rpc(call, "pa_osm_snapshot_begin_import", {
    p_source_name: metadata.sourceName,
    p_source_url: metadata.sourceUrl,
    p_attribution: osmSnapshotAttribution,
    p_dataset_timestamp: metadata.datasetTimestamp,
  });

  async function loadRows(
    operation: "places" | "businesses",
    functionName: "pa_osm_load_places" | "pa_osm_load_businesses",
    rows: SnapshotPlace[] | SnapshotBusiness[],
  ) {
    for (let i = 0; i < rows.length; i += chunkSize) {
      await rpc(call, functionName, { p_rows: rows.slice(i, i + chunkSize) });
      options.onProgress?.(
        operation,
        Math.min(i + chunkSize, rows.length),
        rows.length,
      );
    }
  }

  try {
    await loadRows("places", "pa_osm_load_places", snapshot.places);
    await loadRows("businesses", "pa_osm_load_businesses", snapshot.businesses);
    await rpc(call, "pa_osm_snapshot_complete_import", {
      p_places_imported: snapshot.places.length,
      p_businesses_imported: snapshot.businesses.length,
    });
  } catch (cause) {
    try {
      await rpc(call, "pa_osm_snapshot_fail_import", {
        p_error: importError(cause),
      });
    } catch {
      // If a status write also fails, preserve the original failure. A loading
      // state remains blocked rather than being mistaken for a ready source.
    }
    throw cause;
  }

  return {
    sourceName: metadata.sourceName,
    sourceUrl: metadata.sourceUrl,
    datasetTimestamp: metadata.datasetTimestamp,
    placesImported: snapshot.places.length,
    businessesImported: snapshot.businesses.length,
  };
}
