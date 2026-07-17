/**
 * Deterministic hashed bag-of-features "embedding" for offline hybrid RAG.
 * Not a neural embedding — stable, dependency-free cosine similarity.
 */

import { tokenize } from "./tokenize";

export const EMBED_DIM = 64;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** L2-normalized float32-like vector as number[]. */
export function hashEmbed(text: string, dim = EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
    // second hash for smoothing
    const h2 = hashToken(`${token}#`);
    vec[h2 % dim] += sign * 0.5;
  }

  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vec.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += a[i] * b[i];
  return dot;
}
