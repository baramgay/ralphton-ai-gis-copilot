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
  expect(body.hits.every((hit: { subjectMatchLength?: number }) => typeof hit.subjectMatchLength === "number")).toBe(true);
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

it("shows the same two-district scope evidence as the parser for Masan card sales", async () => {
  const response = await POST(new Request("http://localhost/api/rag/search", {
    method: "POST", body: JSON.stringify({ query: "마산 카드매출 높은 지역", useRemoteEmbed: false }),
  }));
  const body = await response.json();
  expect(body.hits[0].tags).not.toContain("geography");
  expect(body.citations.some((citation: { id: string }) => citation.id === "geography-group-마산")).toBe(true);
  expect(body.context).toContain("마산합포구");
  expect(body.context).toContain("마산회원구");
  expect(body.hits.filter((hit: { inContext: boolean }) => hit.inContext).map((hit: { id: string }) => hit.id))
    .toEqual(body.citations.map((citation: { id: string }) => citation.id));
});
