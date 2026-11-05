import { NextRequest, NextResponse } from "next/server";
import { AIProviderError, CompatibleAI } from "@/lib/ai";
import { generateAndSaveConcept } from "@/lib/ai-workflow";
import {
  memoryConceptRepository,
  publicVerifiedLead,
} from "../../../../tests/ai-fixtures";

// TEMPORARY preview-only live provider test route. Removed after the one
// bounded verification request. No database, real user, or browser access.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.AI_WORKFLOW_TEST_TOKEN;
  if (!expected || token !== expected)
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  if (!process.env.OLLAMA_API_KEY)
    return NextResponse.json(
      { ok: false, error: "Ollama Cloud is not configured." },
      { status: 503 },
    );
  try {
    const result = await generateAndSaveConcept({
      rawLead: publicVerifiedLead,
      provider: new CompatibleAI(),
      repository: memoryConceptRepository(),
    });
    const contentChecks = {
      has_email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(result.content),
      has_phone:
        /\+\d[\d\s().-]{7,}\d|\b\d{3}[-.)\s]?\d{3}[-.)\s]?\d{4}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/.test(
          result.content,
        ),
      claims_website_absence:
        /\b(no website|does not have a website|doesn't have a website|without a website|website absent|no official website|has no site|no online presence)\b/i.test(
          result.content,
        ),
      has_url: /https?:\/\/|www\./i.test(result.content),
      has_injection:
        /ignore (all|any|previous|prior)|system prompt|api[_ -]?key|secret key/i.test(
          result.content,
        ),
      has_editable_copy: /Editable website copy/.test(result.content),
      has_structure: /Suggested website structure/.test(result.content),
      has_visual_direction: /Visual direction/.test(result.content),
      has_uncertainties: /Uncertain information/.test(result.content),
    };
    return NextResponse.json({
      ok: true,
      live_provider_used: result.provider === "Ollama Cloud",
      provider: result.provider,
      model: result.model,
      generated_at: result.generated_at,
      latency_ms: result.latency_ms,
      proposal: {
        id: result.proposal.id,
        origin: result.proposal.origin,
        version: result.proposal.version,
        ai_provider: result.proposal.ai_provider,
        ai_model: result.proposal.ai_model,
        generated_at: result.proposal.generated_at,
      },
      facts_snapshot: result.facts_snapshot,
      content_checks: contentChecks,
      concept: result.concept,
    });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "AI workflow failed before a valid concept was received.";
    return NextResponse.json(
      {
        ok: false,
        code: cause instanceof AIProviderError ? cause.code : "internal",
        error: message,
      },
      { status: cause instanceof AIProviderError ? cause.status : 500 },
    );
  }
}
