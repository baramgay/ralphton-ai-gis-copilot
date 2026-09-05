/**
 * Kimi 외부 검증 — 항목 4: MAD 이상치 판정이 22개 표본에서 뜻이 있는가
 *
 * 실행: npx vitest run scripts/kimi-review/4-mad.test.ts
 *
 * 측정:
 *  - 실제 KOSIS 지표 값으로 중앙값·MAD가 창원 중복 5점에 얼마나 끌리는가 (22점 vs 18점)
 *  - 이상치 목록이 두 표본 정의에서 어떻게 달라지는가
 *  - 분포의 왜도(정규 가정의 0.6745·3배 해석이 성립하는지의 배경)
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { findOutliers } from "@/lib/analysis/statistics";
import type { LayerCube } from "@/lib/layers/types";

const CHANGWON_GU = new Set(["48121", "48123", "48125", "48127", "48129"]);

function sggLatest(layerId: string, key: string) {
  const cube = JSON.parse(readFileSync(`public/data/layers/${layerId}.json`, "utf8")) as LayerCube;
  const bySgg = new Map<string, { name: string; value: number }>();
  for (const cell of cube.cells) {
    const prefix = cell.code.slice(0, 5);
    if (bySgg.has(prefix)) continue;
    const series = cell.series[key];
    if (!series) continue;
    for (let i = series.length - 1; i >= 0; i -= 1) {
      const v = series[i];
      if (v != null && Number.isFinite(v)) {
        bySgg.set(prefix, { name: cell.name.replace(/^경상남도\s*/, ""), value: v });
        break;
      }
    }
  }
  return bySgg;
}

function skewness(values: number[]): number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const m2 = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const m3 = values.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  return m3 / Math.pow(m2, 1.5);
}

function analyze(layerId: string, key: string, label: string) {
  const bySgg = sggLatest(layerId, key);
  const samples22 = [...bySgg.entries()].map(([code, o]) => ({ code, name: o.name, value: o.value }));
  const seen = new Set<string>();
  const samples18 = samples22.filter((s) => {
    const bucket = CHANGWON_GU.has(s.code) ? "CW" : s.code;
    if (seen.has(bucket)) return false;
    seen.add(bucket);
    return true;
  });

  const r22 = findOutliers(samples22);
  const r18 = findOutliers(samples18);
  const v18 = samples18.map((s) => s.value);

  console.log(`\n== ${label} (${layerId}.${key}) ==`);
  console.log(`  22점: median=${r22.median.toFixed(2)} MAD=${r22.mad.toFixed(2)} 이상치=[${r22.rows.map((r) => `${r.name} ${r.value}(${r.score.toFixed(1)}배)`).join(", ") || "없음"}]`);
  console.log(`  18점: median=${r18.median.toFixed(2)} MAD=${r18.mad.toFixed(2)} 이상치=[${r18.rows.map((r) => `${r.name} ${r.value}(${r.score.toFixed(1)}배)`).join(", ") || "없음"}]`);
  console.log(`  왜도(18점)=${skewness(v18).toFixed(2)} (정규=0, |1| 이상이면 비대칭 큼)`);
}

describe("항목4: MAD 실측", () => {
  it("6개 지표에서 22점/18점 비교", () => {
    analyze("kosis-finance", "fiscal_independence", "재정자립도");
    analyze("kosis-housing", "vacant", "빈집 비율");
    analyze("kosis-housing", "old_housing", "노후주택 비율");
    analyze("kosis-safety", "fire_rate", "화재 발생률");
    analyze("kosis-safety", "hitrun_rate", "뺑소니율");
    analyze("kosis-health", "beds", "인구 천명당 병상");
  });
});
