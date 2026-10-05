/** Compare deployed offline/remote retrieval without downloading production credentials. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const baseURL = new URL(process.argv[2] ?? "https://gnbc.site");
if (!["https:", "http:"].includes(baseURL.protocol)) throw new Error("Expected an HTTP(S) base URL");
const cases = [
  ...JSON.parse(await readFile(new URL("../tests/fixtures/rag-korean-qa.json", import.meta.url), "utf8")),
  ...JSON.parse(await readFile(new URL("../tests/fixtures/rag-paraphrase-qa.json", import.meta.url), "utf8")),
];
const report = { measuredAt: new Date().toISOString(), origin: baseURL.origin,
  actualRemote: false, failure: null, results: [], latency: null,
  usage: null, usageNote: "Provider token usage and cost must be read from the provider dashboard; HTTP responses do not expose them.",
};
const durations = { offline: [], remote: [] };
try {
  for (const entry of cases) {
    const pair = {};
    for (const [mode, useRemoteEmbed] of [["offline", false], ["remote", true]]) {
      const started = performance.now();
      const response = await fetch(new URL("/api/rag/search", baseURL), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: entry.query, limit: 5, useRemoteEmbed }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`search_http_${response.status}`);
      const result = await response.json();
      if (result.ok !== true || !Array.isArray(result.hits)) throw new Error("invalid_search_response");
      durations[mode].push(performance.now() - started);
      const ids = result.hits.map((hit) => hit.id);
      const rank = ids.findIndex((id) => entry.expectedIds.includes(id)) + 1;
      const matched = entry.kind === "combined" ? entry.expectedIds.every((id) => ids.includes(id))
        : entry.kind === "relevant" ? rank === 1 : ids.length === 0;
      pair[mode] = { ids, rank: rank || null, matched, remoteApplied: result.remoteEmbed === true };
    }
    report.results.push({ query: entry.query, kind: entry.kind, ...pair });
    // Missing credentials/deadline fallback is a failed real-remote trial, never a green comparison.
    if ((entry.kind === "relevant" || entry.kind === "combined") && !pair.remote.remoteApplied) {
      report.failure = "remote_not_applied";
      process.exitCode = 2;
      break;
    }
  }
  report.actualRemote = report.results.length === cases.length &&
    report.results.filter((entry) => entry.kind === "relevant" || entry.kind === "combined")
      .every((entry) => entry.remote.remoteApplied);
  if (report.actualRemote && report.results.some((entry) => !entry.offline.matched || !entry.remote.matched)) {
    report.failure = "retrieval_quality_regression";
    process.exitCode = 1;
  }
  const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
  report.latency = { samplesPerMode: report.results.length,
    offlineP50Ms: percentile(durations.offline, .5), offlineP95Ms: percentile(durations.offline, .95),
    remoteP50Ms: percentile(durations.remote, .5), remoteP95Ms: percentile(durations.remote, .95),
    scope: "client HTTP including server/provider; first request may be cold; excludes generation and rendering",
  };
} catch (error) {
  report.failure = error instanceof Error ? error.message : "comparison_failed";
  process.exitCode = 2;
} finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/nurimap-rag-remote-api.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
