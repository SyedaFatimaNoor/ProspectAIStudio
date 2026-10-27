import { CompatibleAI } from "../src/lib/ai";

if (!process.env.OLLAMA_API_KEY)
  throw new Error(
    "OLLAMA_API_KEY is required for this server-side Ollama Cloud smoke test.",
  );

const reply = await new CompatibleAI().generateConcept({
  name: "Test business",
  category: "cafe",
  city: "Karachi",
  country: "Pakistan",
});

// Intentionally print only the provider reply; never log configuration or keys.
process.stdout.write(`${reply}\n`);
