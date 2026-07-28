import { describe, expect, test } from "vitest";

import {
  detectMissingMetric,
  detectUnsupportedFacility,
} from "@/lib/analysis/query-signals";

/*
 * 셋 다 "가진 것으로 슬쩍 바꿔 답하던" 자리다. 답을 못 하는 것보다, 다른 답을 자신 있게
 * 하는 것이 나쁘다 — 사용자에게는 둘이 구분되지 않는다.
 */
describe("detectUnsupportedFacility", () => {
  test.each([
    "1km 안에 편의점 많은 동",
    "학교 근처 소비 많은 동",
    "터미널 근처 카드매출 높은 곳",
    "군부대 근처 상권",
  ])("위치 데이터가 없는 시설은 멈춘다: %s", (query) => {
    expect(detectUnsupportedFacility(query)).not.toBeNull();
  });

  test.each(["2km 안에 병원 많은 동", "약국 없는 동네", "치과 접근성 나쁜 곳"])(
    "의료기관은 실제로 있으므로 통과: %s",
    (query) => {
      expect(detectUnsupportedFacility(query)).toBeNull();
    },
  );

  test.each(["생활인구 많은 동", "카드매출 낮은 읍면동"])("일반 지표 질의는 안 건드린다: %s", (query) => {
    expect(detectUnsupportedFacility(query)).toBeNull();
  });
});

describe("detectMissingMetric", () => {
  test("1인가구는 세대수가 아니다", () => {
    const hit = detectMissingMetric("1인가구 많고 소득 낮은 동");
    expect(hit?.label).toBe("1인가구");
    expect(hit?.have).toContain("세대수");
  });

  test("출산율은 출생 수가 아니다", () => {
    const hit = detectMissingMetric("출산율 높은 지역");
    expect(hit?.label).toBe("출산율");
    expect(hit?.have).toContain("출생");
  });

  test("세대수를 그대로 물으면 막지 않는다", () => {
    expect(detectMissingMetric("세대수 많은 동")).toBeNull();
    expect(detectMissingMetric("가구 수 많은 읍면동")).toBeNull();
  });

  test("출생 수를 그대로 물으면 막지 않는다", () => {
    expect(detectMissingMetric("출생 많은 동")).toBeNull();
  });
});
