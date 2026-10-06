import { readFile, mkdir, writeFile } from "node:fs/promises";

const baseURL = (process.argv[2] ?? "http://127.0.0.1:3110").replace(/\/$/, "");
const label = process.argv[3] ?? "latest";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error("Report label must contain letters, numbers, underscores or hyphens.");
const cases = JSON.parse(await readFile(new URL("../tests/fixtures/llm-interpretation-qa.json", import.meta.url), "utf8"));
const results = [];

function sameMembers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function distribution(rows) {
  const values = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (fraction) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
  return { requests: values.length, medianMs: percentile(0.5), p95Ms: percentile(0.95) };
}

for (const entry of cases) {
  const started = performance.now();
  const errors = [];
  let httpStatus = null;
  let json = {};
  try {
    const response = await fetch(`${baseURL}/api/ai/parse`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: entry.query }), signal: AbortSignal.timeout(45_000),
    });
    httpStatus = response.status;
    json = await response.json();
    if (httpStatus !== 200) errors.push(`HTTP ${httpStatus}`);
    if (entry.expectedMetric) {
      if (json.intent !== null || json.metricHint?.layerId !== entry.expectedMetric.layerId
        || json.metricHint?.metricKey !== entry.expectedMetric.metricKey) errors.push("private metric mismatch");
    } else {
      if ((json.intent?.tool ?? null) !== entry.expectedTool) errors.push("tool mismatch");
      if (json.metricHint !== undefined) errors.push("unexpected private metric");
    }
    if (entry.expectedRegions && !sameMembers(json.intent?.filters?.regions, entry.expectedRegions)) errors.push("region scope mismatch");
    if (entry.expectedCompare && !sameMembers(json.intent?.filters?.compare, entry.expectedCompare)) errors.push("comparison scope mismatch");
    if (json.diagnostics?.aiUsed !== entry.expectedAiUsed) errors.push("AI usage mismatch");
    if (!entry.expectedAiUsed && json.diagnostics?.aiAttempted !== false) errors.push("unexpected AI attempt");
    if (entry.expectedClarification && (!(typeof json.notice === "string" && /여러|같은 이름|어느|지역.*(?:선택|지정|명시)|시.*군.*구/.test(json.notice))
      || !Array.isArray(json.suggestions) || json.suggestions.length < 2)) errors.push("missing regional clarification");
    if (entry.expectedNoEvidence && ((json.rag?.citations?.length ?? 0) !== 0 || (json.rag?.hitCount ?? 0) !== 0)) errors.push("unsupported query has evidence");
    // The report deliberately records only interpreted conditions and safe diagnostics, never raw prompts, headers or credentials.
    if (JSON.stringify(json).match(/bearer\s|api[_-]?key|sk-[a-zA-Z0-9]{10,}/i)) errors.push("response contains credential-shaped material");
  } catch (error) {
    errors.push(error instanceof Error ? error.name : "request failed");
  }
  const result = {
    id: entry.id, query: entry.query, expected: entry, httpStatus,
    elapsedMs: Math.round(performance.now() - started),
    actual: {
      tool: json.intent?.tool ?? null, filters: json.intent?.filters ?? null,
      metricHint: json.metricHint ? { layerId: json.metricHint.layerId, metricKey: json.metricHint.metricKey } : null,
      parser: json.parser ?? null, aiAttempted: json.diagnostics?.aiAttempted ?? null,
      aiUsed: json.diagnostics?.aiUsed ?? null, failures: json.diagnostics?.failures ?? [],
      citationIds: (json.rag?.citations ?? []).map((citation) => citation.id),
      clarificationSuggestions: entry.expectedClarification ? json.suggestions ?? [] : undefined,
    },
    passed: errors.length === 0, errors,
  };
  results.push(result);
  console.log(`${result.passed ? "PASS" : "FAIL"} ${entry.id} ${result.elapsedMs}ms${errors.length ? `: ${errors.join(", ")}` : ""}`);
}

const failures = results.filter((row) => !row.passed);
const report = {
  checkedAt: new Date().toISOString(), baseURL, label, remoteEmbeddingRequired: false,
  latencyDefinition: "Sequential real HTTP request through parsed JSON body; includes network/server/retrieval/model time, not model-only latency. No latency pass threshold is inferred from this small sample.",
  checked: results.length, passed: results.length - failures.length, failed: failures.length,
  httpLatency: {
    expectedLlmPath: distribution(results.filter((row) => row.expected.expectedAiUsed)),
    expectedRulesPath: distribution(results.filter((row) => !row.expected.expectedAiUsed)),
    actuallyUsedLlm: distribution(results.filter((row) => row.actual.aiUsed === true)),
  }, results,
};
await mkdir("logs", { recursive: true });
const reportPath = `logs/nurimap-llm-${label}.json`;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, checked: report.checked, passed: report.passed, failed: report.failed, httpLatency: report.httpLatency }));
if (failures.length) process.exitCode = 1;
