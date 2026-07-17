/**
 * Server-only RAG augmentation with optional remote embedding re-rank.
 * Do not import from client components (pulls node:fs via embed-cache).
 */

import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import type { EmbeddingClientDeps } from "./embeddings";
import type { RagAugmentation } from "./augment";
import { formatRagContext } from "./retrieve";
import { retrieveRagChunksWithRemote } from "./retrieve-remote";

export async function augmentQueryWithRagRemote(
  query: string,
  extras?: {
    intent?: AnalysisIntent | null;
    extraTags?: string[];
    embedDeps?: EmbeddingClientDeps;
  },
): Promise<RagAugmentation> {
  const boostTags = [
    ...(extras?.intent ? [extras.intent.tool] : []),
    ...(extras?.extraTags ?? []),
  ];
  const { hits, remote } = await retrieveRagChunksWithRemote(
    { query, limit: 4, boostTags },
    extras?.embedDeps,
  );
  return {
    hits,
    context: formatRagContext(hits),
    citations: hits.map((hit) => ({ id: hit.chunk.id, title: hit.chunk.title })),
    remote,
  };
}
