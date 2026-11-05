import { CompatibleAI } from "../src/lib/ai";
import { generateAndSaveConcept } from "../src/lib/ai-workflow";
import {
  memoryConceptRepository,
  publicVerifiedLead,
} from "../tests/ai-fixtures";

if (!process.env.OLLAMA_API_KEY)
  throw new Error(
    "OLLAMA_API_KEY is required for this server-side Ollama Cloud workflow test.",
  );

try {
  // One real provider request through the application workflow. The repository
  // is process-local; this script never touches production workspace data.
  const result = await generateAndSaveConcept({
    rawLead: publicVerifiedLead,
    provider: new CompatibleAI(),
    repository: memoryConceptRepository(),
  });
  // Print only the validated structured response actually received from Ollama.
  // Never print configuration, credentials, audit records, or health text.
  process.stdout.write(`${JSON.stringify(result.concept, null, 2)}\n`);
} catch (cause) {
  const message =
    cause instanceof Error
      ? cause.message
      : "AI workflow failed before a valid concept was received.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
