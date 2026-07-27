import { describe, expect, test } from "vitest";

import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { resolveMultiQuery } from "@/lib/layers/resolve-multi-query";

/**
 * 지표 셋 이상을 겹쳐 보는 해석.
 *
 * 가장 중요한 성질은 **기존 경로를 뺏지 않는 것**이다. 한두 개짜리 질의까지 이쪽으로
 * 끌고 오면 지금 잘 답하고 있는 것들이 조용히 다른 경로로 새어 나간다.
 */
const layers = CROSS_CANDIDATE_LAYERS;

describe("resolveMultiQuery", () => {
  test("지표가 셋이면 셋 다 잡는다", () => {
    const match = resolveMultiQuery("생활인구 카드매출 평균소득", layers);
    expect(match).not.toBeNull();
    expect(match!.operands).toHaveLength(3);
    // 질의에 나온 순서를 지킨다.
    const labels = match!.operands.map((operand) => operand.metricLabel);
    expect(new Set(labels).size).toBe(3);
  });

  test("단서가 없으면 모두 높은 쪽으로 본다", () => {
    const match = resolveMultiQuery("생활인구 카드매출 평균소득", layers);
    expect(match!.operands.every((operand) => operand.direction === "high")).toBe(true);
  });

  test("지표마다 방향을 따로 읽는다", () => {
    const match = resolveMultiQuery("생활인구 많고 평균소득 높고 연체율 낮은 곳", layers);
    expect(match).not.toBeNull();
    expect(match!.operands).toHaveLength(3);
    // 마지막(연체율)만 낮은 쪽이다.
    expect(match!.operands.at(-1)!.direction).toBe("low");
    expect(match!.operands.slice(0, -1).every((operand) => operand.direction === "high")).toBe(true);
  });

  test("지표가 둘이면 null — 기존 교차 경로의 몫이다", () => {
    expect(resolveMultiQuery("소득 대비 소비가 과한 지역", layers)).toBeNull();
    expect(resolveMultiQuery("생활인구 많고 소득 낮은 동", layers)).toBeNull();
  });

  test("지표가 하나면 null — 단일 경로의 몫이다", () => {
    expect(resolveMultiQuery("생활인구 많은 동", layers)).toBeNull();
    expect(resolveMultiQuery("평균소득 높은 곳", layers)).toBeNull();
  });

  test("2지표 교차 해석이 그대로 살아 있다", () => {
    // 이 경로를 뺏지 않았는지 함께 확인한다.
    const cross = resolveCrossQuery("소득 대비 소비가 과한 지역", layers);
    expect(cross).not.toBeNull();
    expect(cross!.mode).toBe("gap");
  });

  test("빈 질의는 null", () => {
    expect(resolveMultiQuery("", layers)).toBeNull();
    expect(resolveMultiQuery("   ", layers)).toBeNull();
  });

  test("지역 이름을 읽어 좁힌다", () => {
    const match = resolveMultiQuery("김해에서 생활인구 카드매출 평균소득 높은 곳", layers);
    expect(match).not.toBeNull();
    // 단일 지표 경로와 같은 규칙으로 정규화된다("김해" → "김해시").
    expect(match!.regionFilters.some((filter) => filter.startsWith("김해"))).toBe(true);
  });

  test("시군구를 물으면 시군구 단위", () => {
    const match = resolveMultiQuery("시군구별 생활인구 카드매출 평균소득", layers);
    expect(match).not.toBeNull();
    expect(match!.adminLevel).toBe("sgg");
  });
});
