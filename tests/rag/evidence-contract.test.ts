import { describe, expect, it } from "vitest";
import cases from "../fixtures/rag-korean-qa.json";
import { augmentQueryWithRag } from "@/lib/rag/augment";
import { retrieveRagChunks, formatRagContext } from "@/lib/rag/retrieve";

describe("independently labeled Korean evidence cases", () => {
  it.each(cases.filter((entry) => entry.kind !== "relevant"))("$id has no supporting GIS evidence", ({ query }) => {
    expect(retrieveRagChunks({ query, limit: 5 })).toEqual([]);
    expect(augmentQueryWithRag(query).citations).toEqual([]);
  });

  it("keeps every relevant case in top five", () => {
    const missed = cases.filter((entry) => entry.kind === "relevant").filter((entry) =>
      !retrieveRagChunks({ query: entry.query, limit: 5 }).some((hit) => entry.expectedIds.includes(hit.chunk.id)),
    );
    expect(missed).toEqual([]);
  });

  it.each(["김해 딸기 케이크 만드는 법", "창원 클래식 작곡 방법", "중앙동 스파게티 레시피 알려줘"])("place names alone do not ground unrelated topics: %s", (query) => {
    expect(retrieveRagChunks({ query, limit: 5 })).toEqual([]);
    expect(augmentQueryWithRag(query).citations).toEqual([]);
  });

  it.each(["평균소득순위 알려줘", "평균소득비교 알려줘"])("recognizes ranking suffixes only for registered subjects: %s", (query) => {
    expect(retrieveRagChunks({ query, limit: 5 }).some((hit) => hit.chunk.id === "metric-kcb-credit-avg_income")).toBe(true);
  });

  it("does not manufacture evidence from suffixes on noise", () => {
    expect(retrieveRagChunks({ query: "김해 qzxvbnm순위 알려줘", limit: 5 })).toEqual([]);
  });

  it("keeps domain evidence when an in-scope place is also mentioned", () => {
    expect(retrieveRagChunks({ query: "김해 평균소득순위", limit: 5 }).some((hit) => hit.chunk.id === "metric-kcb-credit-avg_income")).toBe(true);
    expect(retrieveRagChunks({ query: "김해 현황", limit: 5 }).some((hit) => hit.chunk.id === "tool-compare-detail")).toBe(true);
  });

  it("tag boosts cannot fabricate evidence for noise", () => {
    expect(retrieveRagChunks({ query: "qzxvbnm", boostTags: ["rankHospitalScarcity"] })).toEqual([]);
  });

  it("shared ranking and administrative words do not support an unrelated metric", () => {
    const hits = retrieveRagChunks({ query: "혼자 지내는 노인이 많은 시군구", limit: 5 });
    expect(hits.map((hit) => hit.chunk.id)).not.toContain("metric-nh-demographics-corporate_share");
    expect(hits[0]?.chunk.id).toBe("metric-kosis-welfare-solo_elderly");
  });

  it("cites exactly the chunks present in the context budget", () => {
    const augmentation = augmentQueryWithRag("김해 평균소득 대출보유율 카드매출 생활인구 비교");
    const ids = [...augmentation.context.matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1]);
    expect(augmentation.citations.map((item) => item.id)).toEqual(ids);
  });

  it("context budget counts newline separators", () => {
    const hits = retrieveRagChunks({ query: "병원 부족", limit: 2 });
    const first = formatRagContext(hits.slice(0, 1));
    const second = formatRagContext(hits.slice(1));
    const budget = first.length + second.length;
    expect(formatRagContext(hits, budget).length).toBeLessThanOrEqual(budget);
  });
});
