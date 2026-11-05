import test from "node:test";
import assert from "node:assert/strict";
import { duplicateMatchReason } from "../src/lib/duplicate-matching";

const base = {
  provider: "openstreetmap",
  source_id: "node/1",
  name: "Harbor Café",
  city: "Karachi",
  category: "cafe",
  phone: null,
  website: null,
  facts: { address: "Seaview Road", coordinates: { lat: 24.8, lon: 67.0 } },
};
test("deduplication matching follows the documented ordered reasons", () => {
  assert.equal(
    duplicateMatchReason(base, { ...base, name: "Other" }),
    "exact_osm_element_id",
  );
  assert.equal(
    duplicateMatchReason(
      { ...base, source_id: "node/2", website: "https://www.example.test/a" },
      { ...base, source_id: "node/3", website: "example.test" },
    ),
    "normalized_website_domain",
  );
  assert.equal(
    duplicateMatchReason(
      {
        ...base,
        source_id: "node/2",
        website: null,
        phone: "+92 300 123 4567",
      },
      {
        ...base,
        source_id: "node/3",
        website: null,
        phone: "92 (300) 123-4567",
      },
    ),
    "normalized_phone",
  );
  assert.equal(
    duplicateMatchReason(
      { ...base, source_id: "node/2" },
      { ...base, source_id: "node/3", name: "HARBOR CAFÉ!" },
    ),
    "exact_normalized_name_city",
  );
  assert.equal(
    duplicateMatchReason(
      {
        ...base,
        source_id: "node/2",
        name: "Harbor Café Express",
        phone: null,
        website: null,
        facts: { coordinates: { lat: 25.2, lon: 67.4 } },
      },
      {
        ...base,
        source_id: "node/3",
        name: "Harbor Café",
        phone: null,
        website: null,
        facts: { coordinates: { lat: 24.8, lon: 67.0 } },
      },
    ),
    null,
    "similar names far apart remain separate",
  );
  assert.equal(
    duplicateMatchReason(
      {
        ...base,
        source_id: "node/2",
        phone: null,
        website: null,
        facts: { address: "Seaview Road" },
      },
      {
        ...base,
        source_id: "node/3",
        phone: null,
        website: null,
        facts: { address: "Seaview Road" },
      },
    ),
    "exact_normalized_name_city",
    "missing coordinates never create a proximity match",
  );
});
