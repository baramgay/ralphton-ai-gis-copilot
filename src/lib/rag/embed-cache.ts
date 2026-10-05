/**
 * In-memory (+ optional disk) cache for remote corpus embeddings.
 * Used to re-rank hybrid RAG when DashScope embedding API is configured.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { RAG_CORPUS } from "./corpus";
import { createTextEmbeddings, cosine, isValidEmbeddingVector, type EmbeddingClientDeps } from "./embeddings";

export type EmbedCacheState = {
  model: string;
  identity: string;
  updatedAt: string;
  vectors: Record<string, number[]>;
};

let memoryCache: EmbedCacheState | null = null;
const warming = new Map<string, Promise<Map<string, number[]> | null>>();

/** Test-only: clear in-memory cache between cases (disk still skipped under VITEST). */
export function resetEmbedCacheForTests(): void {
  memoryCache = null;
  warming.clear();
}

function cachePath(): string {
  return path.join(process.cwd(), ".data", "rag-embed-cache.json");
}

function validState(state: EmbedCacheState, identity: string): boolean {
  if (state?.identity !== identity || !state.vectors || typeof state.vectors !== "object") return false;
  const vectors = RAG_CORPUS.map((chunk) => state.vectors[chunk.id]);
  return Object.keys(state.vectors).length === RAG_CORPUS.length &&
    vectors.every((vector) => isValidEmbeddingVector(vector) && vector.length === vectors[0]?.length);
}

async function loadDiskCache(identity: string): Promise<EmbedCacheState | null> {
  try {
    const text = await readFile(cachePath(), "utf8");
    const parsed = JSON.parse(text) as EmbedCacheState;
    return validState(parsed, identity) ? parsed : null;
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
  const texts = RAG_CORPUS.map(
    (chunk) => `${chunk.title}\n${chunk.body}\n${chunk.keywords.join(" ")}`,
  );
  const identity = createHash("sha256").update(JSON.stringify({
    provider: deps.baseUrl?.trim().replace(/\/+$/, ""), model,
    chunks: RAG_CORPUS.map((chunk, index) => [chunk.id, texts[index]]),
  })).digest("hex");
  if (memoryCache && validState(memoryCache, identity)) {
    return new Map(Object.entries(memoryCache.vectors));
  }

  const pending = warming.get(identity);
  if (pending) return pending;

  const task = (async () => {
    // Avoid leaking local .data cache into unit tests.
    const skipDisk = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
    const disk = skipDisk ? null : await loadDiskCache(identity);
    if (disk) {
      memoryCache = disk;
      return new Map(Object.entries(disk.vectors));
    }

    const vectors = await createTextEmbeddings(deps, texts);
    if (!vectors) return null;

    const record: Record<string, number[]> = {};
    RAG_CORPUS.forEach((chunk, index) => {
      record[chunk.id] = vectors[index];
    });
    const state = { model, identity, updatedAt: new Date().toISOString(), vectors: record };
    if (!validState(state, identity)) return null;
    memoryCache = state;
    if (!skipDisk) await saveDiskCache(memoryCache);
    return new Map(Object.entries(record));
  })().finally(() => {
    warming.delete(identity);
  });

  warming.set(identity, task);
  return task;
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
  if (!isValidEmbeddingVector(queryVectors?.[0])) return null;
  const q = queryVectors[0];
  const dimension = corpusMap.values().next().value?.length;
  if (q.length !== dimension) return null;

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
