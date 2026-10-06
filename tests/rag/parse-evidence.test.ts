import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIntentWithFallbacks } from "@/lib/ai/parse-intent";
import { ragQueryIssue } from "@/lib/rag/query-scope";
import { ALLOWED_TOOLS } from "@/lib/analysis/intent-schema";
import { RAG_CORPUS } from "@/lib/rag/corpus";

afterEach(() => vi.unstubAllEnvs());
describe("parser grounding", () => {
  it("has grounding documents for every registered public tool", () => {
    expect(ALLOWED_TOOLS.filter((tool) => !RAG_CORPUS.some((chunk) => chunk.tags.includes(tool)))).toEqual([]);
  });

  it("does not mistake an in-scope facility name for an outside analysis region", () => {
    expect(ragQueryIssue("김해시 서울병원 접근성")).toBeNull();
  });

  it("does not describe supported KCB migration as unavailable", () => {
    const unsupported = RAG_CORPUS.find((chunk) => chunk.id === "unsupported")!;
    expect(unsupported.body).not.toContain("전입·전출, 도로망");
  });
  it.each(["김해 신축 아파트 실거래가", "서울 강남구 소득 높은 동네", "내일 비트코인 가격 예측"])("rejects unsupported %s before a model call", async (query) => {
    const fetch = vi.fn();
    const result = await parseIntentWithFallbacks(query, { apiKey: "fixture", fetch });
    expect(result.intent).toBeNull();
    expect(result.rag?.citations).toEqual([]);
    expect(result.diagnostics?.aiAttempted).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not let a model invent a metric outside its supplied evidence", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: JSON.stringify({ tool: "privateMetric", layerId: "kcb-credit", metricKey: "delinquency_ratio" }) } }],
    }) });
    const result = await parseIntentWithFallbacks("아이 키우기 좋은 곳", { apiKey: "fixture", fetch });
    expect(result.metricHint).toBeUndefined();
  });

  it("rejects a registered public tool absent from the supplied evidence", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: JSON.stringify({ tool: "rankBirthCount", filters: {} }) } }],
    }) });
    const result = await parseIntentWithFallbacks("아이 키우기 좋은 곳", { apiKey: "fixture", fetch, useRemoteRagEmbed: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.rag?.citations.some((citation) => citation.id === "tool-death-birth")).toBe(false);
    expect(result.intent).toBeNull();
    expect(result.diagnostics?.aiUsed).toBe(false);
  });

  it("accepts a public tool grounded in the evidence for a rules miss", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: JSON.stringify({ tool: "rankHospitalScarcity", filters: {} }) } }],
    }) });
    const result = await parseIntentWithFallbacks("가기 힘든 지역", { apiKey: "fixture", fetch, useRemoteRagEmbed: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.intent?.tool).toBe("rankHospitalScarcity");
    expect(result.rag?.citations.some((citation) => citation.id === "tool-scarcity")).toBe(true);
  });

  it("returns exactly the evidence supplied to the successful model call", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: JSON.stringify({ tool: "rankHospitalScarcity", filters: {} }) } }],
    }) });
    const result = await parseIntentWithFallbacks("가기 힘든 지역", { apiKey: "fixture", fetch, useRemoteRagEmbed: false });
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content as string;
    const contextIds = [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1]);
    expect(result.rag?.citations.map((item) => item.id)).toEqual(contextIds);
    expect(result.rag?.hitCount).toBe(contextIds.length);
  });
});
