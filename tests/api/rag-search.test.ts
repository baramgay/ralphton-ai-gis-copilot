import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rag/search/route";

beforeEach(() => {
  vi.stubEnv("EMBED_API_KEY", "");
  vi.stubEnv("EMBED_BASE_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

it("marks candidates outside the context and cites only included evidence", async () => {
  const response = await POST(new Request("http://localhost/api/rag/search", {
    method: "POST", body: JSON.stringify({ query: "인구 생활인구 카드매출 평균소득 고령비율", limit: 10, useRemoteEmbed: false }),
  }));
  const body = await response.json();
  const contextIds = [...body.context.matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1]);
  expect(body.hits.length).toBeGreaterThan(contextIds.length);
  expect(body.hits.filter((hit: { inContext: boolean }) => hit.inContext).map((hit: { id: string }) => hit.id)).toEqual(contextIds);
  expect(body.citations.map((citation: { id: string }) => citation.id)).toEqual(contextIds);
  expect(body.context.length).toBeLessThanOrEqual(1200);
  expect(body.mode).toBe("hybrid-bm25-hash-embed");
});

it("returns empty evidence rather than fabricated support", async () => {
  const response = await POST(new Request("http://localhost/api/rag/search", {
    method: "POST", body: JSON.stringify({ query: "내일 비트코인 가격 예측", useRemoteEmbed: false }),
  }));
  const body = await response.json();
  expect(body.hits).toEqual([]);
  expect(body.citations).toEqual([]);
  expect(body.context).toBe("");
});
