import { describe, expect, it } from "vitest";
import { DISTRICT_GROUP_ALIASES } from "@/lib/analysis/query-catalog-meta";
import { augmentQueryWithRag } from "@/lib/rag/augment";
import { augmentQueryWithRagRemote } from "@/lib/rag/augment-remote";
import { RAG_CORPUS } from "@/lib/rag/corpus";
import { buildQueryRagContext, retrieveRagChunks } from "@/lib/rag/retrieve";

describe("registered geographic scope in RAG context", () => {
  it.each(["마산 카드매출 높은 지역", "마산시 카드매출 높은 지역", "창원 마산 카드매출 높은 지역"])(
    "grounds the metric and both districts for %s", (query) => {
      const result = augmentQueryWithRag(query);
      expect(result.hits[0]?.chunk.id).toBe("metric-nh-consumption-card_sales");
      const geography = result.hits.find((hit) => hit.chunk.tags.includes("district-group"));
      expect(geography).toBeDefined();
      expect(RAG_CORPUS).toContain(geography!.chunk);
      for (const district of DISTRICT_GROUP_ALIASES.마산) {
        expect(geography!.chunk.body).toContain(district);
        expect(geography!.chunk.tags).toContain(district);
      }
      expect(result.citations.map((item) => item.id)).toEqual(
        [...result.context.matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1]),
      );
    },
  );

  it.each(["마산합포구 카드매출 높은 지역", "마산회원구 카드매출", "마산 중앙동 카드매출"])(
    "does not broaden explicitly narrowed scope: %s", (query) => {
      expect(augmentQueryWithRag(query).hits.some((hit) => hit.chunk.tags.includes("district-group"))).toBe(false);
    },
  );

  it.each(["마산", "마산 케이크 만드는 법", "마산 클래식 작곡 방법", "마산 비트코인 가격 예측"])(
    "does not turn place names into domain evidence: %s", (query) => {
      expect(augmentQueryWithRag(query).citations).toEqual([]);
    },
  );

  it("adds the same geographic evidence to remote augmentation with offline fallback", async () => {
    const query = "마산 카드매출 높은 지역";
    expect(await augmentQueryWithRagRemote(query)).toEqual(augmentQueryWithRag(query));
  });

  it("omits geographic citations when the context budget only fits the metric", () => {
    const query = "마산 카드매출 높은 지역";
    const hits = retrieveRagChunks({ query });
    const first = hits[0];
    const budget = `[${first.chunk.id}] ${first.chunk.title}: ${first.chunk.body}`.length;
    const result = buildQueryRagContext(query, hits, budget);
    expect(result.hits.map((hit) => hit.chunk.id)).toEqual([first.chunk.id]);
    expect(result.context.length).toBeLessThanOrEqual(budget);
  });

  it("the regional tool guide no longer collapses Changwon into Uichang", () => {
    const guide = RAG_CORPUS.find((chunk) => chunk.id === "tool-compare-detail")!;
    expect(guide.body).toContain("창원시 전체(5개 구)");
    expect(guide.body).not.toContain("창원→창원시 의창구");
  });
});
