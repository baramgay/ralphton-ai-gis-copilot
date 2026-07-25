import { describe, expect, test } from "vitest";

import { PRIVATE_LAYERS } from "@/lib/layers/catalog";
import { resolveTrendQuery } from "@/lib/layers/resolve-trend-query";

describe("resolveTrendQuery", () => {
  test.each([
    ["카드매출 늘어나는 동", "nh-consumption", "card_sales", "rising"],
    ["카드매출 증가하는 지역", "nh-consumption", "card_sales", "rising"],
    ["생활인구 줄어드는 곳", "skt-living", "living_total", "falling"],
    ["생활인구 감소하는 동", "skt-living", "living_total", "falling"],
    ["평균소득 오르는 동", "kcb-credit", "avg_income", "rising"],
    ["연체율 하락하는 지역", "kcb-credit", "delinquency_ratio", "falling"],
    ["전입 늘고 있는 동", "kcb-migration", "move_in", "rising"],
    ["야간 매출 증가하는 곳", "nh-hourly", "night_sales", "rising"],
  ])('"%s" → %s/%s (%s)', (query, layerId, metricKey, direction) => {
    const match = resolveTrendQuery(query, PRIVATE_LAYERS);
    expect(match?.layerId).toBe(layerId);
    expect(match?.metricKey).toBe(metricKey);
    expect(match?.direction).toBe(direction);
  });

  test("방향을 묻지 않으면 추세 질의가 아니다", () => {
    // 값의 크기를 묻는 기존 질의는 단일 시점 경로가 그대로 처리해야 한다.
    expect(resolveTrendQuery("카드매출 높은 동", PRIVATE_LAYERS)).toBeNull();
    expect(resolveTrendQuery("생활인구 많은 곳", PRIVATE_LAYERS)).toBeNull();
  });

  test("지표를 못 찾으면 방향만으로 추세를 만들지 않는다", () => {
    expect(resolveTrendQuery("증가하는 동", PRIVATE_LAYERS)).toBeNull();
    expect(resolveTrendQuery("", PRIVATE_LAYERS)).toBeNull();
  });

  test("가장 긴 트리거가 이긴다 — 생활인구가 인구에 먹히지 않는다", () => {
    const match = resolveTrendQuery("생활인구 증가하는 동", PRIVATE_LAYERS);
    expect(match?.layerId).toBe("skt-living");
  });

  test("증감 표현이 함께 있으면 뒤에 온 서술을 방향으로 본다", () => {
    // "증가율이 감소" 같은 문장에서 실제 방향은 뒤쪽이다.
    expect(resolveTrendQuery("카드매출 증가폭이 감소하는 동", PRIVATE_LAYERS)?.direction).toBe(
      "falling",
    );
  });

  test("시군구 단위를 알아본다", () => {
    expect(resolveTrendQuery("시군구별 카드매출 증가", PRIVATE_LAYERS)?.adminLevel).toBe("sgg");
    expect(resolveTrendQuery("카드매출 증가하는 동", PRIVATE_LAYERS)?.adminLevel).toBe("dong");
  });

  test("공공 인구 증감은 이 경로로 오지 않는다(민간 레이어만 후보)", () => {
    // 호출부가 민간 레이어만 넘기므로 "인구 늘어나는 지역"은 기존 공공 도구가 처리한다.
    const match = resolveTrendQuery("인구 늘어나는 지역", PRIVATE_LAYERS);
    expect(match?.provider).not.toBe("공공");
  });
});
