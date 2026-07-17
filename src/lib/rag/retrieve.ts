import { RAG_CORPUS, type RagChunk } from "./corpus";
import { cosineSimilarity, hashEmbed } from "./hash-embed";
import { termFrequency, tokenize } from "./tokenize";

export type RagHit = {
  chunk: RagChunk;
  score: number;
  reasons: string[];
  lexicalScore?: number;
  vectorScore?: number;
};

export type RetrieveOptions = {
  query: string;
  limit?: number;
  /** Boost chunks whose tags intersect these values (tool ids, metrics). */
  boostTags?: string[];
  corpus?: RagChunk[];
  /** Optional remote embedding vectors aligned with corpus order (advanced). */
  queryVector?: number[];
  chunkVectors?: Map<string, number[]>;
  /** Weights for hybrid fusion (default 0.55 lexical / 0.45 vector). */
  lexicalWeight?: number;
  vectorWeight?: number;
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

/** Cached hash embeddings for default corpus */
const DEFAULT_CHUNK_VECTORS = new Map<string, number[]>(
  RAG_CORPUS.map((chunk) => [
    chunk.id,
    hashEmbed(`${chunk.title} ${chunk.body} ${chunk.keywords.join(" ")}`),
  ]),
);

function bm25LiteScore(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
  corpusSize: number,
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
    const idfWeight = idf.get(token) ?? Math.log(1 + corpusSize);
    const denom = f + k1 * (1 - b + (b * dl) / avgDl);
    score += idfWeight * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function normalizeScores(values: number[]): number[] {
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

/**
 * Hybrid retrieval: BM25-lite + hashed vector cosine (+ optional remote vectors).
 * Deterministic offline by default.
 */
export function retrieveRagChunks(options: RetrieveOptions): RagHit[] {
  const limit = options.limit ?? 4;
  const corpus = options.corpus ?? RAG_CORPUS;
  const idf = corpus === RAG_CORPUS ? DEFAULT_IDF : buildIdf(corpus);
  const queryTokens = tokenize(options.query);
  const boostTags = new Set(options.boostTags ?? []);
  const queryLower = options.query.toLowerCase();
  const lw = options.lexicalWeight ?? 0.55;
  const vw = options.vectorWeight ?? 0.45;

  const queryHash = options.queryVector ?? hashEmbed(options.query);
  const chunkVectors =
    options.chunkVectors ??
    (corpus === RAG_CORPUS
      ? DEFAULT_CHUNK_VECTORS
      : new Map(
          corpus.map((chunk) => [
            chunk.id,
            hashEmbed(`${chunk.title} ${chunk.body} ${chunk.keywords.join(" ")}`),
          ]),
        ));

  const raw = corpus.map((chunk) => {
    const docText = `${chunk.title} ${chunk.body} ${chunk.keywords.join(" ")}`;
    const docTokens = tokenize(docText);
    let lexical = bm25LiteScore(queryTokens, docTokens, idf, corpus.length);
    const reasons: string[] = [];

    if (lexical > 0) reasons.push("lexical");

    for (const keyword of chunk.keywords) {
      if (queryLower.includes(keyword.toLowerCase()) || options.query.includes(keyword)) {
        lexical += 2.2;
        reasons.push(`kw:${keyword}`);
      }
    }

    for (const tag of chunk.tags) {
      if (boostTags.has(tag)) {
        lexical += 3.5;
        reasons.push(`tag:${tag}`);
      }
    }

    if (options.query.includes(chunk.title.slice(0, 4))) {
      lexical += 1.2;
      reasons.push("title");
    }

    const docVec = chunkVectors.get(chunk.id) ?? hashEmbed(docText);
    const vector = cosineSimilarity(queryHash, docVec);
    if (vector > 0.05) reasons.push("vector");

    return { chunk, lexical, vector, reasons: [...new Set(reasons)] };
  });

  const lexNorm = normalizeScores(raw.map((row) => row.lexical));
  const vecNorm = normalizeScores(raw.map((row) => row.vector));

  const hits: RagHit[] = raw.map((row, index) => {
    const score = lw * lexNorm[index] + vw * vecNorm[index];
    // Preserve absolute signal: zero both → drop
    const dead = row.lexical <= 0 && row.vector < 0.08;
    return {
      chunk: row.chunk,
      score: dead ? 0 : score + row.lexical * 0.02,
      reasons: row.reasons,
      lexicalScore: row.lexical,
      vectorScore: row.vector,
    };
  });

  return hits
    .filter((hit) => hit.score > 0.08)
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
