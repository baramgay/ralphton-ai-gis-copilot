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
  if (base.length === 0 || !embedDeps?.apiKey || !embedDeps?.baseUrl) {
    return { hits: base, remote: false };
  }

  // Optional re-ranking must not hold a usable offline answer behind a slow API.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scores: Map<string, number> | null;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 2000);
    });
    scores = await Promise.race([
      rerankWithRemoteEmbeddings(options.query, base.map((hit) => hit.chunk.id), {
        ...embedDeps, signal: controller.signal,
      }),
      deadline,
    ]);
  } catch {
    return { hits: base, remote: false };
  } finally {
    clearTimeout(timer);
  }
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
