import { RAG_CORPUS, type RagChunk } from "./corpus";
import { termFrequency, tokenize } from "./tokenize";

export type RagHit = {
  chunk: RagChunk;
  score: number;
  reasons: string[];
};

export type RetrieveOptions = {
  query: string;
  limit?: number;
  /** Boost chunks whose tags intersect these values (tool ids, metrics). */
  boostTags?: string[];
  corpus?: RagChunk[];
};

/** Precompute document frequencies once per corpus instance. */
function buildIdf(corpus: RagChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of corpus) {
    const unique = new Set(tokenize(`${chunk.title} ${chunk.body} ${chunk.keywords.join(" ")}`));
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const n = corpus.length;
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + n / (1 + count)));
  }
  return idf;
}

const DEFAULT_IDF = buildIdf(RAG_CORPUS);

function bm25LiteScore(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const tf = termFrequency(docTokens);
  const avgDl = 80;
  const k1 = 1.4;
  const b = 0.75;
  const dl = docTokens.length;
  let score = 0;
  for (const token of queryTokens) {
    const f = tf.get(token) ?? 0;
    if (f === 0) continue;
    const idfWeight = idf.get(token) ?? Math.log(1 + RAG_CORPUS.length);
    const denom = f + k1 * (1 - b + (b * dl) / avgDl);
    score += idfWeight * ((f * (k1 + 1)) / denom);
  }
  return score;
}

/**
 * Hybrid retrieval: BM25-lite on tokens + keyword/tag boosts.
 * Deterministic, offline, no network.
 */
export function retrieveRagChunks(options: RetrieveOptions): RagHit[] {
  const limit = options.limit ?? 4;
  const corpus = options.corpus ?? RAG_CORPUS;
  const idf = corpus === RAG_CORPUS ? DEFAULT_IDF : buildIdf(corpus);
  const queryTokens = tokenize(options.query);
  const boostTags = new Set(options.boostTags ?? []);
  const queryLower = options.query.toLowerCase();

  const hits: RagHit[] = corpus.map((chunk) => {
    const docText = `${chunk.title} ${chunk.body} ${chunk.keywords.join(" ")}`;
    const docTokens = tokenize(docText);
    let score = bm25LiteScore(queryTokens, docTokens, idf);
    const reasons: string[] = [];

    if (score > 0) reasons.push("lexical");

    for (const keyword of chunk.keywords) {
      if (queryLower.includes(keyword.toLowerCase()) || options.query.includes(keyword)) {
        score += 2.2;
        reasons.push(`kw:${keyword}`);
      }
    }

    for (const tag of chunk.tags) {
      if (boostTags.has(tag)) {
        score += 3.5;
        reasons.push(`tag:${tag}`);
      }
    }

    // Title exact-ish boost
    if (options.query.includes(chunk.title.slice(0, 4))) {
      score += 1.2;
      reasons.push("title");
    }

    return { chunk, score, reasons: [...new Set(reasons)] };
  });

  return hits
    .filter((hit) => hit.score > 0.5)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}

export function formatRagContext(hits: RagHit[], maxChars = 1200): string {
  if (hits.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const block = `[${hit.chunk.id}] ${hit.chunk.title}: ${hit.chunk.body}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n");
}
