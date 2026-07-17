/**
 * Optional remote embeddings via DashScope-compatible API.
 * Falls back silently; hybrid retrieve always has hash-embed offline path.
 */

import type { QwenClientDeps } from "@/lib/ai/qwen";

export type EmbeddingClientDeps = QwenClientDeps & {
  model?: string;
};

const DEFAULT_EMBED_MODEL = "text-embedding-v3";

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
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: deps.model?.trim() || DEFAULT_EMBED_MODEL,
        input: texts,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    if (!Array.isArray(data.data) || data.data.length === 0) return null;

    const ordered = [...data.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const vectors = ordered.map((row) => row.embedding).filter(Array.isArray) as number[][];
    return vectors.length === texts.length ? vectors : null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
