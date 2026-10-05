import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const baseURL = process.argv[2] ?? "http://127.0.0.1:3110";
const cases = JSON.parse(await readFile("tests/fixtures/rag-korean-qa.json", "utf8"));
// These acceptance questions were selected separately from the implementation benchmark.
const acceptance = [
  { id: "heldout-income", query: "경남 평균소득 자료의 산출 기준", kind: "relevant", expectedTags: ["kcb-credit"] },
  { id: "heldout-fire", query: "경남 주민 만명당 화재 발생 건수", kind: "relevant", expectedTags: ["kosis-safety"] },
  { id: "heldout-night", query: "낮보다 밤에 사람이 모이는 상권", kind: "relevant", expectedTags: ["skt-daynight", "nh-hourly"] },
  { id: "heldout-loan", query: "주민의 대출 보유 비율이 높은 곳", kind: "relevant", expectedTags: ["kcb-credit"] },
  { id: "heldout-recipe", query: "김해에서 딸기 케이크 만드는 방법", kind: "irrelevant", expectedTags: [] },
  { id: "heldout-music", query: "창원에서 클래식 음악 작곡하는 방법", kind: "irrelevant", expectedTags: [] },
];
const results = [];
const failures = [];

async function post(endpoint, body) {
  const started = performance.now();
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  const json = await response.json();
  return { httpStatus: response.status, elapsedMs: Math.round(performance.now() - started), json };
}

for (const entry of [...cases, ...acceptance]) {
  const result = await post("/api/rag/search", { query: entry.query, limit: 5, useRemoteEmbed: false });
  const hits = result.json.hits ?? [];
  const citations = result.json.citations ?? [];
  const context = result.json.context ?? "";
  const expectedIds = entry.expectedIds ?? [];
  const expectedTags = entry.expectedTags ?? [];
  const matched = entry.kind === "relevant"
    ? hits.some((hit) => expectedIds.includes(hit.id) || expectedTags.some((tag) => hit.tags?.includes(tag)))
    : hits.length === 0 && citations.length === 0 && context === "";
  const lineage = citations.every((citation) => context.includes(`[${citation.id}]`) && hits.some((hit) => hit.id === citation.id && hit.inContext))
    && hits.every((hit) => hit.inContext === context.includes(`[${hit.id}]`))
    && hits.filter((hit) => hit.inContext).length === citations.length;
  if (result.httpStatus !== 200 || !matched || !lineage) failures.push({ id: entry.id, matched, lineage, httpStatus: result.httpStatus, returned: hits.map((hit) => hit.id) });
  results.push({ id: entry.id, query: entry.query, kind: entry.kind, elapsedMs: result.elapsedMs, matched, lineage, ids: hits.map((hit) => hit.id) });
}

const parserCases = [
  ["병원 가기 힘든 읍면 어디야", "rankHospitalScarcity"],
  ["가기 힘든 지역", "rankHospitalScarcity"],
  ["진주시와 거제시 비교", "compareRegions"],
  ["서울 강남구 소득 높은 동네", null],
  ["김해 신축 아파트 실거래가", null],
  ["김해에서 딸기 케이크 만드는 방법", null],
  ["창원에서 클래식 음악 작곡하는 방법", null],
  ["xyzzy foobar 12345", null],
];
const parserResults = [];
for (const [query, expectedTool] of parserCases) {
  const result = await post("/api/ai/parse", { query });
  const actualTool = result.json.intent?.tool ?? null;
  const noEvidence = expectedTool !== null || (result.json.rag?.citations?.length ?? 0) === 0;
  if (result.httpStatus !== 200 || actualTool !== expectedTool || !noEvidence) failures.push({ query, expectedTool, actualTool, noEvidence, httpStatus: result.httpStatus });
  parserResults.push({ query, expectedTool, actualTool, elapsedMs: result.elapsedMs, parser: result.json.parser, aiUsed: result.json.diagnostics?.aiUsed, citations: result.json.rag?.citations?.map((citation) => citation.id) ?? [] });
}

await mkdir("test-results", { recursive: true });
const report = { checkedAt: new Date().toISOString(), baseURL, remoteEmbeddingRequested: false, searchCases: results.length, parserCases: parserResults.length, results, parserResults, failures };
await writeFile("test-results/nurimap-rag-api.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ baseURL, searchCases: results.length, parserCases: parserResults.length, failures }));
assert.equal(failures.length, 0, "RAG/API acceptance failed; see test-results/nurimap-rag-api.json");
