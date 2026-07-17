import type { EmbeddingClientDeps } from "./embeddings";
import { rerankWithRemoteEmbeddings } from "./embed-cache";
import { retrieveRagChunks, type RagHit, type RetrieveOptions } from "./retrieve";

/**
 * Hybrid retrieve then optional remote embedding re-rank (server-only).
 */
export async function retrieveRagChunksWithRemote(
  options: RetrieveOptions,
  embedDeps?: EmbeddingClientDeps,
): Promise<{ hits: RagHit[]; remote: boolean }> {
  const base = retrieveRagChunks(options);
  if (!embedDeps?.apiKey || !embedDeps?.baseUrl) {
    return { hits: base, remote: false };
  }

  const scores = await rerankWithRemoteEmbeddings(
    options.query,
    base.map((hit) => hit.chunk.id),
    embedDeps,
  );
  if (!scores || scores.size === 0) {
    return { hits: base, remote: false };
  }

  const fused = base
    .map((hit) => {
      const remote = scores.get(hit.chunk.id) ?? 0;
      // fuse remote cosine into score
      const score = hit.score * 0.55 + Math.max(0, remote) * 0.45;
      return {
        ...hit,
        score,
        reasons: [...hit.reasons, "remote-embed"],
        vectorScore: remote,
      };
    })
    .sort((a, b) => b.score - a.score);

  return { hits: fused.slice(0, options.limit ?? 4), remote: true };
}
