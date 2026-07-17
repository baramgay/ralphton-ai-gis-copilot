import { describe, expect, test } from "vitest";

import { cosineSimilarity, hashEmbed } from "@/lib/rag/hash-embed";
import { retrieveRagChunks } from "@/lib/rag/retrieve";

describe("hash-embed hybrid", () => {
  test("similar texts have higher cosine than unrelated", () => {
    const a = hashEmbed("의료 취약 병원 부족");
    const b = hashEmbed("병원이 부족한 의료취약 지역");
    const c = hashEmbed("오늘 날씨와 교통 혼잡");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  test("hybrid retrieve includes vector reason on related queries", () => {
    const hits = retrieveRagChunks({ query: "최근접 거리 먼 동", limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => (hit.vectorScore ?? 0) > 0)).toBe(true);
  });

  test("lexical+vector scores are exposed", () => {
    const hits = retrieveRagChunks({ query: "출생 사망 자연감소", limit: 2 });
    expect(hits[0]?.lexicalScore).toBeDefined();
    expect(hits[0]?.vectorScore).toBeDefined();
  });
});
