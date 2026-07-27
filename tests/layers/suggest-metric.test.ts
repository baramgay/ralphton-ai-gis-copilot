import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { jamoDistance, suggestMetrics } from "@/lib/layers/suggest-metric";

describe("jamoDistance", () => {
  test("같은 말은 0", () => {
    expect(jamoDistance("카드매출", "카드매출")).toBe(0);
  });

  test("한 글자 오타는 가깝다", () => {
    expect(jamoDistance("카드매츨", "카드매출")).toBeLessThanOrEqual(2);
    expect(jamoDistance("생활인그", "생활인구")).toBeLessThanOrEqual(2);
    expect(jamoDistance("평균소듣", "평균소득")).toBeLessThanOrEqual(2);
  });

  test("다른 말은 멀다", () => {
    expect(jamoDistance("생활인구", "카드매출")).toBeGreaterThan(4);
  });
});

describe("suggestMetrics", () => {
  // 오타를 자동으로 고쳐 답하면 위험하다 — "소비"와 "소득"은 한 글자 차이지만 전혀 다른
  // 지표다. 잘못 고른 답을 자신 있게 내놓느니 무엇을 찾는지 되묻는 편이 낫다.
  test.each([
    ["생활인그 많은 동", "총생활인구"],
    ["카드매츨 높은 곳", "카드매출"],
    ["평균소듣 높은 동", "평균소득"],
  ])('"%s" → %s 제안', (query, expected) => {
    const suggestions = suggestMetrics(query, CUBE_LAYERS);
    expect(suggestions.map((item) => item.metricLabel)).toContain(expected);
  });

  test("아주 동떨어진 말에는 아무것도 제안하지 않는다", () => {
    // 엉뚱한 것을 제안하면 오히려 헷갈린다.
    expect(suggestMetrics("오늘 날씨 어때", CUBE_LAYERS)).toHaveLength(0);
  });

  test("제안에는 그대로 쓸 수 있는 예시가 붙는다", () => {
    const [first] = suggestMetrics("카드매츨 높은 곳", CUBE_LAYERS);
    expect(first.example).toMatch(/카드매출/);
  });

  test("너무 짧은 질의는 건너뛴다", () => {
    expect(suggestMetrics("가", CUBE_LAYERS)).toHaveLength(0);
  });
});

describe("여러 지표에 걸치는 말", () => {
  // "상권 좋은 곳"은 오타가 아니라 범위가 넓은 말이다. 편집거리로는 안 잡히므로
  // 질의의 두 글자 이상 토막이 트리거에 들어 있으면 후보로 올린다.
  test("상권이 들어간 지표들을 제안한다", () => {
    const labels = suggestMetrics("상권 좋은 곳", CUBE_LAYERS).map((item) => item.metricLabel);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.join(" ")).toMatch(/비중|상권/);
  });

  test("질의 뼈대를 이루는 말은 제안 근거가 되지 못한다", () => {
    // "높은"·"지역"이 지표 이름과 겹친다고 제안하면 아무 질의나 걸린다.
    expect(suggestMetrics("높은 지역 알려줘", CUBE_LAYERS)).toHaveLength(0);
  });
});
