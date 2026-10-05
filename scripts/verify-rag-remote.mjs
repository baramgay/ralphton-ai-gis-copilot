/** Compare actual remote embeddings against the same fixed offline QA labels. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createServer, loadEnv } from "vite";

const gateway = process.argv.includes("--gateway");
const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
if (gateway && !env.VERCEL_OIDC_TOKEN && !env.AI_GATEWAY_API_KEY) {
  // Isolated CLI pull; no secrets are included in reports or passed on the command line.
  try {
    const text = await readFile(".vercel/nurimap-upgrade-production.env", "utf8");
    const token = text.match(/^VERCEL_OIDC_TOKEN="([^"]+)"/m)?.[1];
    if (token) env.VERCEL_OIDC_TOKEN = token;
  } catch { /* Missing configuration is reported below. */ }
}
const config = gateway ? {
  apiKey: env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN,
  baseUrl: "https://ai-gateway.vercel.sh/v1",
  model: "openai/text-embedding-3-small",
} : {
  apiKey: env.EMBED_API_KEY, baseUrl: env.EMBED_BASE_URL,
  model: env.EMBED_MODEL || "text-embedding-v3",
};
const cases = [
  ...JSON.parse(await readFile(new URL("../tests/fixtures/rag-korean-qa.json", import.meta.url), "utf8")),
  ...JSON.parse(await readFile(new URL("../tests/fixtures/rag-paraphrase-qa.json", import.meta.url), "utf8")),
];
const report = {
  measuredAt: new Date().toISOString(), actualRemote: false,
  configuration: { mode: gateway ? "vercel-gateway" : "explicit-provider", model: config.model },
  providerRequests: 0, providerStatuses: [], usage: { promptTokens: 0, totalTokens: 0 },
  failure: null, results: [], quality: null, latency: null,
};
const finish = async () => {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/nurimap-rag-remote.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};
if (!config.apiKey?.trim() || !config.baseUrl?.trim()) {
  report.failure = "credential_missing";
  await finish();
  process.exitCode = 2;
} else {
  const server = await createServer({ configFile: false,
    resolve: { alias: { "@": `${process.cwd()}/src` } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true }, appType: "custom",
  });
  try {
    const { retrieveRagChunks } = await server.ssrLoadModule("/src/lib/rag/retrieve.ts");
    const { retrieveRagChunksWithRemote } = await server.ssrLoadModule("/src/lib/rag/retrieve-remote.ts");
    const { ensureCorpusEmbeddings } = await server.ssrLoadModule("/src/lib/rag/embed-cache.ts");
    const deps = { ...config, fetch: async (...args) => {
      report.providerRequests++;
      const response = await fetch(...args);
      report.providerStatuses.push(response.status);
      try {
        const body = await response.clone().json();
        if (response.ok) {
          report.usage.promptTokens += body.usage?.prompt_tokens ?? 0;
          report.usage.totalTokens += body.usage?.total_tokens ?? 0;
        } else {
          report.failure = typeof body.error?.type === "string" ? body.error.type : `provider_http_${response.status}`;
        }
      } catch { /* No credentials or upstream bodies are logged. */ }
      return response;
    } };
    const coldStart = performance.now();
    const warmed = await ensureCorpusEmbeddings(deps);
    const corpusWarmMs = performance.now() - coldStart;
    if (!warmed) {
      report.failure ||= "provider_unavailable_or_invalid_vectors";
      process.exitCode = 2;
    } else {
      const offlineMs = [], remoteMs = [];
      for (const entry of cases) {
        let started = performance.now();
        const offline = retrieveRagChunks({ query: entry.query, limit: 5 });
        offlineMs.push(performance.now() - started);
        started = performance.now();
        const remote = await retrieveRagChunksWithRemote({ query: entry.query, limit: 5 }, deps);
        remoteMs.push(performance.now() - started);
        const rank = (hits) => {
          const index = hits.findIndex((hit) => entry.expectedIds.includes(hit.chunk.id));
          return index < 0 ? null : index + 1;
        };
        const matched = (hits) => entry.kind === "combined"
          ? entry.expectedIds.every((id) => hits.some((hit) => hit.chunk.id === id))
          : entry.kind === "relevant" ? rank(hits) === 1 : hits.length === 0;
        report.results.push({ query: entry.query, kind: entry.kind,
          offlineRank: rank(offline), remoteRank: rank(remote.hits), remoteApplied: remote.remote,
          offlineMatched: matched(offline), remoteMatched: matched(remote.hits),
          offlineIds: offline.map((hit) => hit.chunk.id), remoteIds: remote.hits.map((hit) => hit.chunk.id),
        });
      }
      const relevant = report.results.filter((entry) => entry.kind === "relevant");
      const combined = report.results.filter((entry) => entry.kind === "combined");
      const absent = report.results.filter((entry) => entry.kind !== "relevant" && entry.kind !== "combined");
      report.actualRemote = [...relevant, ...combined].every((entry) => entry.remoteApplied);
      report.quality = { relevant: relevant.length,
        offlineTop1: relevant.filter((entry) => entry.offlineRank === 1).length,
        remoteTop1: relevant.filter((entry) => entry.remoteRank === 1).length,
        offlineTop5: relevant.filter((entry) => entry.offlineRank !== null).length,
        remoteTop5: relevant.filter((entry) => entry.remoteRank !== null).length,
        absent: absent.length, remoteEmpty: absent.filter((entry) => entry.remoteIds.length === 0).length,
        combined: combined.length, remoteCombined: combined.filter((entry) => entry.remoteMatched).length,
      };
      const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
      report.latency = { samples: cases.length, corpusWarmMs,
        offlineP50Ms: percentile(offlineMs, .5), offlineP95Ms: percentile(offlineMs, .95),
        remoteP50Ms: percentile(remoteMs, .5), remoteP95Ms: percentile(remoteMs, .95),
        scope: "developer-machine retrieval including provider HTTP; excludes generation and rendering",
      };
      if (!report.actualRemote) { report.failure ||= "remote_deadline_fallback"; process.exitCode = 2; }
      else if (report.quality.remoteTop1 < report.quality.offlineTop1 ||
        report.quality.remoteTop5 < report.quality.offlineTop5 || report.quality.remoteEmpty !== absent.length ||
        report.results.some((entry) => entry.offlineMatched && !entry.remoteMatched)) {
        report.failure = "remote_quality_regression"; process.exitCode = 1;
      }
    }
    await finish();
  } finally { await server.close(); }
}
