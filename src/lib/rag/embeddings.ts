/**
 * Optional remote embeddings via an OpenAI-compatible /embeddings endpoint.
 * Falls back silently; hybrid retrieve always has hash-embed offline path.
 *
 * 채팅 제공자와 같은 곳이라고 가정하지 않는다 — 현재 채팅 제공자(DeepSeek)에는
 * 임베딩 엔드포인트가 없다. 자격증명은 EMBED_* 환경변수에서 따로 온다.
 */

import type { LlmClientDeps } from "@/lib/ai/llm";

export type EmbeddingClientDeps = LlmClientDeps & {
  model?: string;
  signal?: AbortSignal;
};

const DEFAULT_EMBED_MODEL = "text-embedding-v3";
// DashScope-compatible providers accept at most ten texts per embedding request.
const EMBEDDING_BATCH_SIZE = 10;

export function isValidEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part)) &&
    value.some((part) => part !== 0);
}

function embeddingUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  // .../compatible-mode/v1 → .../compatible-mode/v1/embeddings
  const basePath = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  url.pathname = basePath.endsWith("/embeddings") ? basePath : `${basePath}/embeddings`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Create embedding vectors for texts. Returns null on any failure / missing config.
 */
export async function createTextEmbeddings(
  deps: EmbeddingClientDeps,
  texts: string[],
): Promise<number[][] | null> {
  const apiKey = deps.apiKey?.trim();
  const baseUrl = deps.baseUrl?.trim();
  if (!apiKey || !baseUrl || texts.length === 0) return null;

  try {
    const url = embeddingUrl(baseUrl);
    const fetchImpl = deps.fetch ?? fetch;
    const signal = deps.signal
      ? AbortSignal.any([deps.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    const vectors: number[][] = [];
    let dimension: number | undefined;
    for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: deps.model?.trim() || DEFAULT_EMBED_MODEL,
          input: batch,
        }),
        signal,
      });

      if (!response.ok) return null;
      const data = (await response.json()) as {
        data?: Array<{ embedding?: unknown; index?: number }>;
      };
      if (!Array.isArray(data.data) || data.data.length !== batch.length) return null;
      const ordered = [...data.data].sort((a, b) => (a?.index ?? -1) - (b?.index ?? -1));
      for (let index = 0; index < ordered.length; index++) {
        const row = ordered[index];
        if (row?.index !== index || !isValidEmbeddingVector(row.embedding)) return null;
        dimension ??= row.embedding.length;
        if (row.embedding.length !== dimension) return null;
        vectors.push(row.embedding);
      }
    }
    return vectors;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !isValidEmbeddingVector(a) || !isValidEmbeddingVector(b)) return 0;
  const n = a.length;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return !Number.isFinite(denom) || denom === 0 || !Number.isFinite(dot) ? 0 : dot / denom;
}
