/**
 * In-memory (+ optional disk) cache for remote corpus embeddings.
 * Used to re-rank hybrid RAG when DashScope embedding API is configured.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RAG_CORPUS } from "./corpus";
import { createTextEmbeddings, cosine, type EmbeddingClientDeps } from "./embeddings";

export type EmbedCacheState = {
  model: string;
  updatedAt: string;
  vectors: Record<string, number[]>;
};

let memoryCache: EmbedCacheState | null = null;
let warming: Promise<Map<string, number[]> | null> | null = null;

/** Test-only: clear in-memory cache between cases (disk still skipped under VITEST). */
export function resetEmbedCacheForTests(): void {
  memoryCache = null;
  warming = null;
}

function cachePath(): string {
  return path.join(process.cwd(), ".data", "rag-embed-cache.json");
}

async function loadDiskCache(model: string): Promise<EmbedCacheState | null> {
  try {
    const text = await readFile(cachePath(), "utf8");
    const parsed = JSON.parse(text) as EmbedCacheState;
    if (parsed.model !== model) return null;
    if (!parsed.vectors || typeof parsed.vectors !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveDiskCache(state: EmbedCacheState): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath()), { recursive: true });
    await writeFile(cachePath(), JSON.stringify(state), "utf8");
  } catch {
    /* read-only env */
  }
}

/**
 * Ensure corpus embeddings are available. Returns null if remote embed unavailable.
 */
export async function ensureCorpusEmbeddings(
  deps: EmbeddingClientDeps,
): Promise<Map<string, number[]> | null> {
  const model = deps.model?.trim() || "text-embedding-v3";
  if (memoryCache?.model === model && Object.keys(memoryCache.vectors).length === RAG_CORPUS.length) {
    return new Map(Object.entries(memoryCache.vectors));
  }

  if (warming) return warming;

  warming = (async () => {
    // Avoid leaking local .data cache into unit tests.
    const skipDisk = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
    const disk = skipDisk ? null : await loadDiskCache(model);
    if (disk && Object.keys(disk.vectors).length === RAG_CORPUS.length) {
      memoryCache = disk;
      return new Map(Object.entries(disk.vectors));
    }

    const texts = RAG_CORPUS.map(
      (chunk) => `${chunk.title}\n${chunk.body}\n${chunk.keywords.join(" ")}`,
    );
    const vectors = await createTextEmbeddings(deps, texts);
    if (!vectors) return null;

    const record: Record<string, number[]> = {};
    RAG_CORPUS.forEach((chunk, index) => {
      record[chunk.id] = vectors[index];
    });
    memoryCache = { model, updatedAt: new Date().toISOString(), vectors: record };
    await saveDiskCache(memoryCache);
    return new Map(Object.entries(record));
  })().finally(() => {
    warming = null;
  });

  return warming;
}

/**
 * Re-rank BM25/hash hits with remote query embedding when available.
 */
export async function rerankWithRemoteEmbeddings(
  query: string,
  chunkIds: string[],
  deps: EmbeddingClientDeps,
): Promise<Map<string, number> | null> {
  const corpusMap = await ensureCorpusEmbeddings(deps);
  if (!corpusMap) return null;

  const queryVectors = await createTextEmbeddings(deps, [query]);
  if (!queryVectors?.[0]) return null;
  const q = queryVectors[0];

  const scores = new Map<string, number>();
  for (const id of chunkIds) {
    const vec = corpusMap.get(id);
    if (!vec) continue;
    scores.set(id, cosine(q, vec));
  }
  return scores;
}

export function getEmbedCacheMeta(): {
  ready: boolean;
  model: string | null;
  chunkCount: number;
  updatedAt: string | null;
} {
  if (!memoryCache) {
    return { ready: false, model: null, chunkCount: 0, updatedAt: null };
  }
  return {
    ready: Object.keys(memoryCache.vectors).length > 0,
    model: memoryCache.model,
    chunkCount: Object.keys(memoryCache.vectors).length,
    updatedAt: memoryCache.updatedAt,
  };
}
