import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  KCB_COMMUTE_LAYER,
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  NH_INDUSTRY_LAYER,
  SKT_DAYNIGHT_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
} from "@/lib/layers/catalog";
import { LayerCubeSchema, type LayerCube, type LayerDescriptor } from "@/lib/layers/types";

/**
 * 큐브 값 범위 계약.
 *
 * KCB MC00006은 명세에 "평균"이라 적혀 있었지만 실제로는 집단 합계였고, 그대로 평균 취급한
 * 탓에 1인 카드소비가 월 5.3억원으로 나갔다. 타입도 스키마도 통과하는 종류의 오류라
 * 어댑터를 새로 붙이거나 원자료 스키마가 바뀔 때 같은 일이 반복될 수 있다.
 *
 * 여기서는 실제 생성된 큐브의 값이 상식 범위 안인지 확인한다. 범위는 넉넉하게 잡아
 * 정상적인 지역 편차는 통과시키되, 단위를 잘못 읽어 자릿수가 어긋나면 반드시 걸리게 한다.
 * 비율이라도 100을 넘을 수 있는 지표(주야비·일자리 배율)는 별도로 상한을 준다.
 */
type Range = { min: number; max: number };

const LAYERS: Array<{
  id: string;
  layer: Omit<LayerDescriptor, "months">;
  ranges: Record<string, Range>;
}> = [
  {
    id: "skt-living",
    layer: SKT_LIVING_LAYER,
    ranges: { living_total: { min: 1, max: 500_000 }, elderly_ratio: { min: 0, max: 100 } },
  },
  {
    id: "skt-mobility",
    layer: SKT_MOBILITY_LAYER,
    ranges: {
      inflow_total: { min: 0, max: 1_000_000 },
      outflow_total: { min: 0, max: 1_000_000 },
      net_flow: { min: -1_000_000, max: 1_000_000 },
    },
  },
  {
    id: "skt-daynight",
    layer: SKT_DAYNIGHT_LAYER,
    ranges: {
      day_population: { min: 1, max: 500_000 },
      night_population: { min: 1, max: 500_000 },
      // 주야비는 비율이라 100을 넘는다(산단은 낮 인구가 몇 배).
      day_night_ratio: { min: 1, max: 5_000 },
    },
  },
  {
    id: "nh-consumption",
    layer: NH_CONSUMPTION_LAYER,
    // 백만원 단위. 원 단위로 잘못 읽으면 1e6배가 되어 상한에 걸린다.
    ranges: { card_sales: { min: 0, max: 1_000_000 }, card_txns: { min: 0, max: 50_000_000 } },
  },
  {
    id: "nh-demographics",
    layer: NH_DEMOGRAPHICS_LAYER,
    ranges: {
      youth_share: { min: 0, max: 100 },
      middle_share: { min: 0, max: 100 },
      senior_share: { min: 0, max: 100 },
      female_share: { min: 0, max: 100 },
      corporate_share: { min: 0, max: 100 },
    },
  },
  {
    id: "nh-hourly",
    layer: NH_HOURLY_LAYER,
    ranges: {
      day_sales: { min: 0, max: 1_000_000 },
      night_sales: { min: 0, max: 1_000_000 },
      night_share: { min: 0, max: 100 },
    },
  },
  {
    id: "nh-industry",
    layer: NH_INDUSTRY_LAYER,
    ranges: {
      food_share: { min: 0, max: 100 },
      retail_share: { min: 0, max: 100 },
      health_share: { min: 0, max: 100 },
      leisure_share: { min: 0, max: 100 },
      education_share: { min: 0, max: 100 },
    },
  },
  {
    id: "kcb-credit",
    layer: KCB_CREDIT_LAYER,
    ranges: {
      // 만원/월. 천원 합계를 평균으로 오인하면 수만 배가 되어 상한에 걸린다.
      avg_income: { min: 50, max: 3_000 },
      credit_score: { min: 300, max: 1_000 },
      card_spend: { min: 10, max: 5_000 },
      loan_ratio: { min: 0, max: 100 },
      delinquency_ratio: { min: 0, max: 100 },
      highend_ratio: { min: 0, max: 100 },
    },
  },
  {
    id: "kcb-migration",
    layer: KCB_MIGRATION_LAYER,
    ranges: { move_in: { min: 0, max: 200_000 }, move_out_sgg: { min: 0, max: 500_000 } },
  },
  {
    id: "kcb-commute",
    layer: KCB_COMMUTE_LAYER,
    ranges: {
      jobs_in: { min: 0, max: 500_000 },
      // 일자리 배율도 비율이라 100을 넘는다(산단은 취업 거주자보다 일자리가 많다).
      job_ratio: { min: 0, max: 5_000 },
      outbound_ratio: { min: 0, max: 100 },
    },
  },
];

function loadCube(id: string): LayerCube | null {
  const file = path.join(process.cwd(), "public", "data", "layers", `${id}.json`);
  if (!existsSync(file)) return null;
  return LayerCubeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function referenceIndex(cube: LayerCube): number {
  const index = cube.months.indexOf(cube.referenceMonth);
  return index >= 0 ? index : cube.months.length - 1;
}

describe("생성된 큐브 값이 상식 범위 안인지", () => {
  test.each(LAYERS.map((entry) => [entry.id, entry] as const))(
    "%s의 모든 지표",
    (id, entry) => {
      const cube = loadCube(id);
      // 큐브는 원자료가 있는 환경에서만 생성된다. 없으면 이 검사는 건너뛴다.
      if (!cube) return;

      const monthIndex = referenceIndex(cube);
      for (const metric of entry.layer.metrics) {
        const range = entry.ranges[metric.key];
        expect(range, `${id}/${metric.key}에 기대 범위가 선언되지 않음`).toBeDefined();

        const values = cube.cells
          .map((cell) => cell.series[metric.key]?.[monthIndex])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

        expect(values.length, `${id}/${metric.key}에 값이 하나도 없음`).toBeGreaterThan(0);

        const min = Math.min(...values);
        const max = Math.max(...values);
        expect(min, `${id}/${metric.key} 최솟값 ${min}이 하한 ${range.min} 미만`).toBeGreaterThanOrEqual(
          range.min,
        );
        expect(max, `${id}/${metric.key} 최댓값 ${max}이 상한 ${range.max} 초과`).toBeLessThanOrEqual(
          range.max,
        );
      }
    },
  );

  test("모든 큐브 레이어가 범위 계약을 가진다", () => {
    // 새 레이어를 붙이면서 계약을 빠뜨리면 여기서 걸린다.
    const declared = new Set(LAYERS.map((entry) => entry.id));
    for (const entry of LAYERS) {
      for (const metric of entry.layer.metrics) {
        expect(Object.keys(entry.ranges)).toContain(metric.key);
      }
    }
    expect(declared.size).toBe(LAYERS.length);
  });
});
