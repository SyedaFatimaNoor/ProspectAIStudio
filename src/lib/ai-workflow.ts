import type { AIConceptGeneration, AIProvider } from "./ai";
import {
  renderConceptMarkdown,
  selectVerifiedLeadFacts,
  type AIConceptOutput,
  type VerifiedFactsSnapshot,
} from "./ai-schema";

export type ConceptProposalWrite = {
  business_id: string;
  title: string;
  content: string;
  version: number;
  origin: "ai";
  ai_provider: string;
  ai_model: string;
  generated_at: string;
  ai_output: AIConceptOutput;
  facts_snapshot: VerifiedFactsSnapshot;
};

export type StoredConceptProposal = ConceptProposalWrite & {
  id: string;
  created_at?: string;
  updated_at?: string;
};

export interface ConceptRepository {
  insertProposal(values: ConceptProposalWrite): Promise<StoredConceptProposal>;
  updateProposal(
    id: string,
    values: ConceptProposalWrite,
  ): Promise<StoredConceptProposal>;
}

export type ExistingAIConcept = { id: string; version: number };

export type GeneratedConceptResult = Omit<
  AIConceptGeneration,
  "facts_snapshot"
> & {
  content: string;
  title: string;
  proposal: StoredConceptProposal;
  facts_snapshot: VerifiedFactsSnapshot;
  regenerated: boolean;
};

/**
 * Validate the lead, generate a strict structured concept, render it into an
 * editable draft, and persist provider/model/timestamp/source provenance.
 * The repository is called only after the provider response is fully valid.
 */
export async function generateAndSaveConcept({
  rawLead,
  provider,
  repository,
  previous = null,
  now = () => new Date().toISOString(),
}: {
  rawLead: unknown;
  provider: Pick<AIProvider, "generateConcept">;
  repository: ConceptRepository;
  previous?: ExistingAIConcept | null;
  now?: () => string;
}): Promise<GeneratedConceptResult> {
  const selection = selectVerifiedLeadFacts(rawLead, now);
  const generation = await provider.generateConcept(selection.facts);
  const meta = {
    provider: generation.provider,
    model: generation.model,
    generated_at: generation.generated_at,
  };
  const content = renderConceptMarkdown(
    selection.facts,
    generation.concept,
    meta,
  );
  const title = `Website concept — ${selection.facts.name}`;
  const values: ConceptProposalWrite = {
    business_id: selection.business_id,
    title,
    content,
    version: previous ? previous.version + 1 : 1,
    origin: "ai",
    ai_provider: generation.provider,
    ai_model: generation.model,
    generated_at: generation.generated_at,
    ai_output: generation.concept,
    facts_snapshot: selection.snapshot,
  };
  const proposal = previous
    ? await repository.updateProposal(previous.id, values)
    : await repository.insertProposal(values);
  return {
    ...generation,
    content,
    title,
    proposal,
    facts_snapshot: selection.snapshot,
    regenerated: Boolean(previous),
  };
}
