// Streaming reader for a public Geofabrik .osm.pbf extract.
// Declare only the fields this module reads.
declare module "osm-pbf-parser" {
  type OsmItem = {
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    refs?: number[];
    tags?: Record<string, string>;
    info?: { version?: number; timestamp?: number };
  };
  export default function osmPbfParser(options?: {
    "skip-comments"?: boolean;
    xml?: boolean;
  }): NodeJS.ReadWriteStream & { items?: OsmItem[] };
  export type { OsmItem };
}
