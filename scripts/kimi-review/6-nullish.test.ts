/**
 * Kimi 외부 검증 — 항목 6: 결손을 좋은 값으로 메우는 자리 — 실패하는 검사
 *
 * 실행: npx vitest run scripts/kimi-review/6-nullish.test.ts
 *
 * 결함 1: aggregateToSgg의 sum 경로가 구성원 null을 0으로 합산한다(aggregate.ts:31).
 *   실제 데이터에 null이 있는 sum 지표가 존재한다:
 *   - nh-demographics.card_sales   null 6/3660
 *   - nh-hourly.day_sales/night_sales  null 4/3660
 *   - kcb-migration.move_in        null 3/1220
 *   아래 검사는 「합계는 구성원이 하나라도 결손이면 null이어야 한다」는
 *   기대(= sumNullableSeries와 같은 철학, tool-registry.ts:154-164)를 적는다.
 *   현행 코드는 이 검사를 통과하지 못한다 — 즉 이 파일의 실패가 결함의 재현이다.
 *
 * 결함 2(검사 대신 재현 로그): trend.changeRate가 null(= 산출 불가, trend.ts:91)인
 *   지역을 `?? 0`으로 정렬하면(trend-view.ts:57-58) 「변화율 산출 불가」가
 *   「변화 0%」로 보합 한가운데에 인쇄된다.
 */
import { describe, expect, it } from "vitest";

import { aggregateToSgg } from "@/lib/layers/aggregate";
import { computeTrend } from "@/lib/layers/trend";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const sumMetric: MetricDef = {
  key: "sales",
  label: "카드매출",
  unit: "만원",
  aggregation: "sum",
  formula: "측정용",
  limitation: "측정용",
  triggers: ["카드매출"],
};

function cubeWithMissing(): LayerCube {
  // 48170(진주) 아래 동 3개 — 그중 하나가 결손(null)
  return {
    layerId: "t",
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: [
      { code: "4817010000", name: "경상남도 진주시 갑동", point: { lat: 35.2, lng: 128.1 }, areaKm2: 1, series: { sales: [100] } },
      { code: "4817011000", name: "경상남도 진주시 을동", point: { lat: 35.2, lng: 128.1 }, areaKm2: 1, series: { sales: [null] } }, // 결손
      { code: "4817012000", name: "경상남도 진주시 병동", point: { lat: 35.2, lng: 128.1 }, areaKm2: 1, series: { sales: [50] } },
    ],
  };
}

describe("항목6: ?? 0 계열 결함", () => {
  it("결함1 재현: sum 집계는 구성원 결손이 있으면 null을 돌려야 한다", () => {
    const sgg = aggregateToSgg(cubeWithMissing(), [sumMetric]);
    const total = sgg.cells[0].series.sales[0];
    console.log(`[재현] 구성원 [100, null, 50]의 시군구 합계 → ${total} (기대: null, 현행: 150)`);
    // 기대: null (있는 것만 더한 150은 실제보다 작은 값이 그럴듯한 얼굴로 인쇄된다)
    expect(total).toBeNull();
  });

  it("결함2 재현: changeRate null(산출 불가)은 0%가 아니다", () => {
    const cannotCompute = computeTrend([0, 12, 15]); // 첫 값 0 → changeRate null
    const trulyFlat = computeTrend([10, 10, 10]);    // 진짜 보합 → changeRate 0
    console.log(`[재현] 산출 불가 지역의 changeRate=${cannotCompute.changeRate}, 보합 지역의 changeRate=${trulyFlat.changeRate}`);
    console.log(`[재현] trend-view.ts:57의 \`changeRate ?? 0\`은 둘을 모두 0으로 정렬한다`);
    expect(cannotCompute.changeRate).toBeNull();
    expect(cannotCompute.changeRate ?? 0).toBe(trulyFlat.changeRate); // ← 이 둘이 같아지는 것이 결함
  });
});
