import { writeFileSync } from "node:fs";
import { aiConceptJsonSchema } from "../src/lib/ai-schema";

// Keep the published JSON Schema byte-for-byte in sync with the runtime
// validator. This script writes no credentials and makes no network requests.
writeFileSync(
  new URL("../docs/ai-concept.schema.json", import.meta.url),
  `${JSON.stringify(aiConceptJsonSchema, null, 2)}\n`,
);
