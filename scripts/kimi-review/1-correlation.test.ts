/**
 * Kimi 외부 검증 — 항목 1: 상관계수 표본 수 (22 vs 18)
 *
 * 실행: npx vitest run scripts/kimi-review/1-correlation.test.ts
 *
 * 측정 대상:
 *  - 앱이 실제로 내는 계수(correlationView 경유, n=22)
 *  - 창원 5구를 1점으로 접은 계수(n=18, 독립 관측)
 *  - 화면 표시 행 수 vs 「표본 n개」 문구의 일치 여부
 *  - 창원 값의 분포 내 위치(극단값 여부)
 *
 * 전부 src의 실제 함수(aggregateToSgg / correlate / correlationView / cityOf)를
 * 불러서 계산한다 — 알고리즘 재구현이 아니라 실측이다.
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { correlate } from "@/lib/analysis/statistics";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import { cityOf, correlationView } from "@/lib/layers/stats-view";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

function loadCube(layerId: string): LayerCube {
  return JSON.parse(
    readFileSync(`public/data/layers/${layerId}.json`, "utf8"),
  ) as LayerCube;
}

function fakeMetric(key: string, label: string, unit = ""): MetricDef {
  return {
    key,
    label,
    unit,
    aggregation: "weightedAvg",
    formula: "측정용",
    limitation: "측정용",
    triggers: [label],
    scope: "sgg",
  };
}

function latestWithMonth(cube: LayerCube, code: string, metricKey: string) {
  const cell = cube.cells.find((c) => c.code === code);
  const series = cell?.series[metricKey];
  if (!cell || !series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return { value: v, month: cube.months[i] };
  }
  return null;
}

const CHANGWON_GU = new Set(["48121", "48123", "48125", "48127", "48129"]);

function measure(layerA: string, keyA: string, labelA: string, layerB: string, keyB: string, labelB: string) {
  const rawA = loadCube(layerA);
  const rawB = loadCube(layerB);
  const metricA = fakeMetric(keyA, labelA);
  const metricB = fakeMetric(keyB, labelB);

  const sggA = aggregateToSgg(rawA, [metricA]);
  const sggB = aggregateToSgg(rawB, [metricB]);

  // --- correlationView가 실제로 보여 주는 것 ---
  const view = correlationView(
    {
      kind: "correlation",
      a: { layerId: layerA, metricKey: keyA, metricLabel: labelA } as never,
      b: { layerId: layerB, metricKey: keyB, metricLabel: labelB } as never,
      adminLevel: "sgg",
      unit: "sgg",
      regionFilters: [],
    },
    { cube: rawA, metric: metricA, metrics: [metricA] },
    { cube: rawB, metric: metricB, metrics: [metricB] },
  );

  // --- 같은 표본으로 correlate 직접: 22점 vs 창원 접은 18점 ---
  const samples22 = sggA.cells.map((cell) => ({
    code: cell.code,
    a: latestWithMonth(sggA, cell.code, keyA)?.value ?? null,
    b: latestWithMonth(sggB, cell.code, keyB)?.value ?? null,
  }));
  const byCity = new Map<string, (typeof samples22)[number]>();
  for (const s of samples22) {
    const bucket = CHANGWON_GU.has(s.code) ? "CHANGWON" : s.code;
    if (!byCity.has(bucket)) byCity.set(bucket, s);
  }
  const samples18 = [...byCity.values()];

  const r22 = correlate(samples22, "sgg");
  const r18 = correlate(samples18, "sgg");

  // 창원 값의 분포 내 위치 (18개 독립 관측 기준)
  const aVals = samples18.map((s) => s.a).filter((v): v is number => v != null).sort((x, y) => x - y);
  const bVals = samples18.map((s) => s.b).filter((v): v is number => v != null).sort((x, y) => x - y);
  const cw = samples22.find((s) => CHANGWON_GU.has(s.code))!;
  const rankA = aVals.filter((v) => v < (cw.a ?? -Infinity)).length + 1;
  const rankB = bVals.filter((v) => v < (cw.b ?? -Infinity)).length + 1;

  // 연도 정합성: 각 축의 최신 값이 어느 달인지
  const monthsA = new Set(samples22.map((s) => latestWithMonth(sggA, s.code, keyA)?.month));
  const monthsB = new Set(samples22.map((s) => latestWithMonth(sggB, s.code, keyB)?.month));

  console.log(`\n===== ${labelA}(${layerA}.${keyA}) × ${labelB}(${layerB}.${keyB}) =====`);
  console.log(`sgg 셀 수: ${sggA.cells.length} / ${sggB.cells.length}`);
  console.log(`축A 사용 월: ${[...monthsA].join(",")} · 축B 사용 월: ${[...monthsB].join(",")}`);
  console.log(`[22점] n=${r22.n} pearson=${r22.pearson?.toFixed(4)} spearman=${r22.spearman?.toFixed(4)} dropped=${r22.dropped}`);
  console.log(`[18점] n=${r18.n} pearson=${r18.pearson?.toFixed(4)} spearman=${r18.spearman?.toFixed(4)} dropped=${r18.dropped}`);
  console.log(`창원 위치: ${labelA} ${rankA}/${aVals.length}위(값 ${cw.a}) · ${labelB} ${rankB}/${bVals.length}위(값 ${cw.b})`);
  console.log(`화면 summary: ${view.summary}`);
  console.log(`화면 notes:`);
  for (const n of view.notes) console.log(`  - ${n}`);
  console.log(`화면 표시 행 수: ${view.rows.length} (접힌 행: ${view.rows.filter((r) => (r.sharedCount ?? 1) > 1).map((r) => `${r.name}×${r.sharedCount}`).join(", ") || "없음"})`);
}

describe("항목1: 상관계수 표본 수 실측", () => {
  it("세 쌍에 대해 22점/18점을 비교한다", () => {
    measure("kosis-finance", "fiscal_independence", "재정자립도", "kosis-housing", "vacant", "빈집 비율");
    measure("kosis-finance", "fiscal_independence", "재정자립도", "kosis-safety", "fire_rate", "화재 발생률");
    measure("kosis-housing", "vacant", "빈집 비율", "kosis-safety", "fire_rate", "화재 발생률");
  });

  it("cityOf가 22개 시군구 실명에서 창원 5구만 접는다", () => {
    const cube = aggregateToSgg(loadCube("kosis-safety"), [fakeMetric("fire_rate", "화재")]);
    const names = cube.cells.map((c) => c.name);
    const folded = new Map<string, number>();
    for (const n of names) folded.set(cityOf(n), (folded.get(cityOf(n)) ?? 0) + 1);
    console.log("\n===== cityOf 결과 =====");
    for (const [city, count] of [...folded.entries()].sort()) {
      console.log(`  ${city}: ${count}개 행`);
    }
  });
});
