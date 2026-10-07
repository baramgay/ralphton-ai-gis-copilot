import { createHash } from 'node:crypto';
import type { ParseIntentDeps, ParseIntentResult } from './parse-intent';

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 100;
type Parser = (query: string, deps: ParseIntentDeps) => Promise<ParseIntentResult>;

/** Per-instance, bounded server memory only; caches interpretations, never analysis values. */
export function createParseIntentCache(parse: Parser): Parser {
  const completed = new Map<string, { expiresAt: number; result: ParseIntentResult }>();
  const pending = new Map<string, Promise<ParseIntentResult>>();
  const transports = new WeakMap<typeof fetch, number>();
  let nextTransport = 0;

  function reused(result: ParseIntentResult, cache: 'hit' | 'shared'): ParseIntentResult {
    const copy = structuredClone(result);
    if (copy.diagnostics?.aiUsed) {
      copy.diagnostics = { aiAttempted: false, aiUsed: true, failures: [], cache };
    }
    return copy;
  }

  return async (query, deps) => {
    if (deps.fetch && !transports.has(deps.fetch)) transports.set(deps.fetch, ++nextTransport);
    // Hash includes all interpretation configuration. Neither query nor credential is retained as a key.
    const key = createHash('sha256').update(JSON.stringify([
      query, deps.apiKey, deps.baseUrl, deps.primaryModel, deps.fallbackModel,
      deps.fetch ? transports.get(deps.fetch) : 0,
      deps.useRemoteRagEmbed ?? null, process.env.RAG_REMOTE_EMBED, process.env.EMBED_MODEL,
      process.env.EMBED_BASE_URL, process.env.EMBED_API_KEY,
    ])).digest('hex');
    const now = Date.now();
    for (const [entryKey, entry] of completed) {
      if (entry.expiresAt <= now) completed.delete(entryKey);
    }
    const cached = completed.get(key);
    if (cached) return reused(cached.result, 'hit');
    const active = pending.get(key);
    if (active) return reused(await active, 'shared');

    // Do not allow distinct concurrent requests to grow this process-local map indefinitely.
    if (pending.size >= MAX_ENTRIES) return parse(query, deps);
    const operation = parse(query, deps);
    pending.set(key, operation);
    try {
      const result = await operation;
      if (result.diagnostics?.aiUsed && (result.intent || result.metricHint)) {
        if (completed.size >= MAX_ENTRIES) completed.delete(completed.keys().next().value!);
        completed.set(key, { expiresAt: Date.now() + TTL_MS, result: structuredClone(result) });
      }
      return result;
    } finally {
      pending.delete(key);
    }
  };
}
