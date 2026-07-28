import { describe, expect, test } from "vitest";

import { TOOL_CATALOG } from "@/lib/analysis/query-catalog";
import { extractQuerySignals } from "@/lib/analysis/query-signals";

/*
 * 세대수는 큐브에도 있고 신호(metricCue "households")도 잡히는데 순위 도구만 없었다.
 * "세대수 많은 동"이 어떤 표현으로도 "등록된 분석 도구와 맞지 않습니다"로 떨어졌다
 * (prod 실측) — 총인구·고령비율·출생은 되는데 세대수만 안 됐다.
 *
 * 이 결함은 회귀 스크립트가 아니라, 1인가구 안내가 "세대수로 물어보세요"라고 가리킨
 * 자리가 정작 답이 안 되는 것을 화면 글자에서 읽고 드러났다.
 */
function bestTool(query: string): string {
  const signals = extractQuerySignals(query);
  const scored = TOOL_CATALOG.map((entry) => {
    const cueHit = entry.metricCues.some((cue) => signals.metrics.has(cue));
    const spatialHit = entry.spatialCues.some((cue) => signals.spatial.has(cue));
    const base = cueHit || spatialHit ? entry.baseScore : 0;
    const bonus = (cueHit ? entry.cueBonus : 0) + (entry.scoreExtra?.(signals) ?? 0);
    return { id: entry.id, score: base === 0 ? 0 : base + bonus };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? "";
}

describe("세대 수 순위 도구", () => {
  test("카탈로그에 등록돼 있다", () => {
    expect(TOOL_CATALOG.some((entry) => entry.id === "rankHouseholdCount")).toBe(true);
  });

  test.each(["세대수 많은 동", "가구 수 많은 읍면동", "세대 많은 지역"])(
    "세대수 질의가 이 도구로 간다: %s",
    (query) => {
      expect(bestTool(query)).toBe("rankHouseholdCount");
    },
  );

  test("1인가구를 물으면 그쪽에 양보한다", () => {
    expect(bestTool("1인가구 비중 높은 동")).toBe("rankSingleHouseholdRisk");
    expect(bestTool("단독가구 많은 곳")).toBe("rankSingleHouseholdRisk");
  });

  test("세대수만으로 판단하지 말라는 경고가 안내에 있다", () => {
    const entry = TOOL_CATALOG.find((item) => item.id === "rankHouseholdCount");
    expect(entry?.notice(extractQuerySignals("세대수 많은 동"))).toMatch(/세대당 인구/);
  });
});
