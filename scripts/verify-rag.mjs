/** Fixed Korean QA labels are read from a fixture, never inferred from rankings. */
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import assert from "node:assert/strict";

const cases = JSON.parse(await readFile(new URL("../tests/fixtures/rag-korean-qa.json", import.meta.url), "utf8"));
const paraphrases = JSON.parse(await readFile(new URL("../tests/fixtures/rag-paraphrase-qa.json", import.meta.url), "utf8"));
const server = await createServer({
  configFile: false,
  resolve: { alias: { "@": `${process.cwd()}/src` } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { retrieveRagChunks, formatRagContext } = await server.ssrLoadModule("/src/lib/rag/retrieve.ts");
  const { RAG_CORPUS } = await server.ssrLoadModule("/src/lib/rag/corpus.ts");
  const coldStart = performance.now();
  retrieveRagChunks({ query: cases[0].query, limit: 5 });
  const coldRetrievalMs = performance.now() - coldStart;
  const results = cases.map((entry) => {
    const hits = retrieveRagChunks({ query: entry.query, limit: 5 });
    const rank = hits.findIndex((hit) => entry.expectedIds.includes(hit.chunk.id));
    const context = formatRagContext(hits);
    return {
      ...entry,
      rank: rank < 0 ? null : rank + 1,
      returnedIds: hits.map((hit) => hit.chunk.id),
      contextIds: hits.filter((hit) => context.includes(`[${hit.chunk.id}]`)).map((hit) => hit.chunk.id),
      lexicalScores: hits.map((hit) => hit.lexicalScore),
    };
  });
  for (let i = 0; i < 20; i++) retrieveRagChunks({ query: cases[i % cases.length].query, limit: 5 });
  const durations = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    retrieveRagChunks({ query: cases[i % cases.length].query, limit: 5 });
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const relevant = results.filter((entry) => entry.kind === "relevant");
  const absent = results.filter((entry) => entry.kind !== "relevant");
  const paraphraseResults = paraphrases.map((entry) => {
    const ids = retrieveRagChunks({ query: entry.query, limit: 5 }).map((hit) => hit.chunk.id);
    const matched = entry.kind === "relevant" ? ids[0] === entry.expectedIds[0]
      : entry.kind === "combined" ? entry.expectedIds.every((id) => ids.includes(id)) : ids.length === 0;
    return { ...entry, returnedIds: ids, matched };
  });
  console.log(JSON.stringify({
    stage: process.argv.slice(2).find((argument) => argument !== "--assert") ?? "measurement",
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0].model },
    mode: "offline-bm25-hash", remoteModelCalls: 0,
    corpusChunks: RAG_CORPUS.length,
    quality: {
      relevant: relevant.length,
      top1: relevant.filter((entry) => entry.rank === 1).length,
      top5: relevant.filter((entry) => entry.rank !== null).length,
      absent: absent.length,
      emptyEvidence: absent.filter((entry) => entry.returnedIds.length === 0).length,
    },
    latency: { warmup: 20, samples: 200, coldRetrievalMs, p50Ms: durations[99], p95Ms: durations[189] },
    results,
    paraphraseQuality: { cases: paraphraseResults.length, passed: paraphraseResults.filter((entry) => entry.matched).length },
    paraphraseResults,
  }, null, 2));
  if (process.argv.includes("--assert")) {
    assert.equal(relevant.filter((entry) => entry.rank === 1).length, relevant.length, "fixed QA top1 regressed");
    assert.equal(relevant.filter((entry) => entry.rank !== null).length, relevant.length, "fixed QA top5 regressed");
    assert.equal(absent.filter((entry) => entry.returnedIds.length === 0).length, absent.length, "fixed QA absent-evidence rejection regressed");
    assert.ok(paraphraseResults.every((entry) => entry.matched), "independent paraphrase QA regressed");
  }
} finally {
  await server.close();
}
