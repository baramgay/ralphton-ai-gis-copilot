import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import type { Interpretation } from "@/lib/analysis/interpret";
import type { AnalysisResult } from "@/lib/analysis/result";

import { formatRagContext, retrieveRagChunks, type RagHit } from "./retrieve";

export type RagAugmentation = {
  hits: RagHit[];
  context: string;
  citations: Array<{ id: string; title: string }>;
  remote?: boolean;
};

/**
 * Retrieve knowledge for a free-form query, optionally biased by tool/metric tags.
 * Client-safe (offline hybrid only).
 */
export function augmentQueryWithRag(
  query: string,
  extras?: { intent?: AnalysisIntent | null; extraTags?: string[] },
): RagAugmentation {
  const boostTags = [
    ...(extras?.intent ? [extras.intent.tool] : []),
    ...(extras?.extraTags ?? []),
  ];
  const hits = retrieveRagChunks({ query, limit: 4, boostTags });
  return {
    hits,
    context: formatRagContext(hits),
    citations: hits.map((hit) => ({ id: hit.chunk.id, title: hit.chunk.title })),
    remote: false,
  };
}

/**
 * Enrich deterministic interpretation with RAG caveats / next-step suggestions.
 */
export function enrichInterpretationWithRag(
  interpretation: Interpretation,
  result: AnalysisResult,
  queryHint?: string,
): Interpretation & { ragCitations: Array<{ id: string; title: string }> } {
  const toolGuess =
    result.title.includes("취약")
      ? "rankHospitalScarcity"
      : result.title.includes("고령")
        ? "rankElderlyUnderserved"
        : result.title.includes("비교")
          ? "compareRegions"
          : result.title.includes("반경") || result.title.includes("접근")
            ? "countFacilitiesWithinRadius"
            : result.title.includes("거리")
              ? "nearestFacilityDistance"
              : "";

  const query = [queryHint, result.title, result.summary, toolGuess].filter(Boolean).join(" ");
  const hits = retrieveRagChunks({
    query,
    limit: 3,
    boostTags: toolGuess ? [toolGuess] : [],
  });

  const caveats = [...interpretation.caveats];
  const suggestions = [...interpretation.suggestions];

  for (const hit of hits) {
    if (hit.chunk.tags.includes("caveat") || hit.chunk.tags.includes("data")) {
      if (!caveats.some((line) => line.includes(hit.chunk.title))) {
        caveats.push(`${hit.chunk.title}: ${hit.chunk.body.slice(0, 120)}`);
      }
    } else if (hit.chunk.tags.includes("follow-up") || hit.chunk.tags.includes("access")) {
      if (suggestions.length < 5) {
        suggestions.push(hit.chunk.body.split(".")[0] + ".");
      }
    }
  }

  // Always surface one method caveat from top hit when empty
  if (caveats.length === 0 && hits[0]) {
    caveats.push(`${hits[0].chunk.title} 참고: ${hits[0].chunk.body.slice(0, 100)}`);
  }

  return {
    ...interpretation,
    caveats: caveats.slice(0, 5),
    suggestions: suggestions.slice(0, 5),
    ragCitations: hits.map((hit) => ({ id: hit.chunk.id, title: hit.chunk.title })),
  };
}

/** Prompt block injected into the AI intent parser. */
export function buildRagPromptSection(query: string): string {
  const { context, citations } = augmentQueryWithRag(query);
  if (!context) return "";
  const cite = citations.map((item) => item.id).join(", ");
  return `\n관련 지식(RAG, id=${cite}):\n${context}\n위 지식을 우선 반영해 tool을 고르세요. 지식과 충돌하는 추정은 하지 마세요.\n`;
}
