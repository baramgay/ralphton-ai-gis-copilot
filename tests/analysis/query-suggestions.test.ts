import { describe, expect, test } from "vitest";

import { QUERY_SUGGESTIONS } from "@/lib/analysis/query-catalog-meta";
import { resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { CROSS_CANDIDATE_LAYERS, NL_LAYERS } from "@/lib/layers/catalog";
import { resolveMultiQuery } from "@/lib/layers/resolve-multi-query";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { resolveStatsQuery } from "@/lib/layers/resolve-stats-query";

/*
 * 추천 질문 칩은 **제품이 자기 손으로 내미는 말**이다. 눌렀는데 "그건 못 합니다"가
 * 나오면 사용자는 자기가 잘못 쓴 줄 안다. 그래서 목록에 올린 말은 전부 답이 나와야 한다.
 *
 * 판정은 화면이 실제로 타는 길과 **같은 순서**로 한다 — 통계 → 교차 → 민간 레이어 →
 * 공공 도구. 한 가지 해석기로만 재면 자기 소관이 아닌 것을 못 한다고 나무란다(실제로
 * `resolveQueryWithRules` 만으로 재서 민간 레이어 질의 7개를 거짓 실패로 올렸다).
 * LLM 은 쓰지 않는다 — 키가 비어 있어도 칩은 화면에 있다.
 */
/* 화면과 같은 후보 목록을 쓴다. 격자 질의만 걸러내는 부분은 추천 질문에 없어 생략한다. */
const CROSS_LAYERS = [...CROSS_CANDIDATE_LAYERS];

const answers = (query: string): string | null => {
  if (resolveMultiQuery(query, CROSS_LAYERS, { adminLevelFallback: "dong" })) return "다중조건";
  if (resolveStatsQuery(query, CROSS_LAYERS, { adminLevelFallback: "dong" })) return "통계";
  if (resolveCrossQuery(query, CROSS_LAYERS, { adminLevelFallback: "dong" })) return "교차";
  if (resolveLayerQuery(query, NL_LAYERS, { adminLevelFallback: "dong" })) return "민간 레이어";
  if (resolveQueryWithRules(query).kind === "intent") return "공공 도구";
  return null;
};

describe("추천 질문", () => {
  test("같은 말이 두 번 있지 않다", () => {
    const seen = new Map<string, number>();
    for (const item of QUERY_SUGGESTIONS) seen.set(item, (seen.get(item) ?? 0) + 1);
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });

  test("모두 규칙만으로 답이 나온다", () => {
    expect(QUERY_SUGGESTIONS.filter((item) => answers(item) === null)).toEqual([]);
  });

  test("모수가 줄지 않았다", () => {
    /*
     * 하나씩 빠져도 위 두 검사는 초록이다. 개수를 못박아 조용한 삭제를 막는다.
     *
     * 2026-09-07에 44 → 41로 **일부러** 내렸다. 「약국만 보여줘」·「주말 여는 약국」·
     * 「야간 진료 병원」 셋을 뺐다. 배포본 자료에 약국이 0곳이고 운영시간이 전건 비어
     * 있어, 권한 대로 눌러도 0건이 나왔다. 위 "모두 규칙만으로 답이 나온다"는 이것을
     * 못 잡는다 — 규칙은 질의를 해석했고, 없는 것은 자료 쪽이었다.
     *
     * 여기서 더 내리려면 같은 종류의 이유를 여기 적어라. 이유 없이 내리는 것이 이
     * 검사가 막으려는 일이다.
     */
    expect(QUERY_SUGGESTIONS.length).toBeGreaterThanOrEqual(41);
  });
});
