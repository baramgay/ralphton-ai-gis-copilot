import { buildLayerView } from "@/lib/layers/select";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";

/**
 * 교차분석(cross-layer analysis): 서로 다른 두 큐브 지표를 각각 z-점수로 표준화한 뒤
 * 합성해 지역을 정렬한다. 민간×공공/민간×민간 결합으로 "유동은 많은데 소비는 적은 곳"
 * 같은 정책 인사이트를 만든다.
 *
 * - mode "gap":  zA − zB  (A는 높고 B는 낮은 순 = "A 대비 B 부족")
 * - mode "both": zA + zB  (A·B 동시에 높은 순)
 */
export type CrossMode = "gap" | "both";

export type CrossRow = {
  code: string;
  name: string;
  composite: number;
  valueA: number | null;
  valueB: number | null;
  zA: number;
  zB: number;
};

export type CrossLayerResult = {
  ranked: CrossRow[];
  /** dong-keyed composite score (min-max 0~100) for the map choropleth. */
  scores: Map<string, number>;
};

function monthIndexOf(cube: LayerCube): number {
  const index = cube.months.indexOf(cube.referenceMonth);
  return index >= 0 ? index : cube.months.length - 1;
}

function standardize(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return { mean, std: std || 1 };
}

export type CrossOperand = { cube: LayerCube; metric: MetricDef; metrics: MetricDef[] };

export function crossLayerView(
  a: CrossOperand,
  b: CrossOperand,
  mode: CrossMode,
  adminLevel: AdminLevel,
): CrossLayerResult {
  const viewA = buildLayerView(a.cube, a.metric.key, adminLevel, monthIndexOf(a.cube), a.metrics);
  const viewB = buildLayerView(b.cube, b.metric.key, adminLevel, monthIndexOf(b.cube), b.metrics);

  const nameByCode = new Map<string, string>();
  for (const row of [...viewA.ranking, ...viewB.ranking]) {
    if (!nameByCode.has(row.code)) nameByCode.set(row.code, row.name);
  }

  // Dongs present (non-null) in BOTH metrics.
  const codes = [...viewA.scores.keys()].filter((code) => viewB.scores.has(code));
  const aValues = codes.map((code) => viewA.scores.get(code) as number);
  const bValues = codes.map((code) => viewB.scores.get(code) as number);
  const statA = standardize(aValues);
  const statB = standardize(bValues);

  const rows: CrossRow[] = codes
    .map((code) => {
      const valueA = viewA.scores.get(code) as number;
      const valueB = viewB.scores.get(code) as number;
      const zA = (valueA - statA.mean) / statA.std;
      const zB = (valueB - statB.mean) / statB.std;
      const composite = mode === "gap" ? zA - zB : zA + zB;
      return { code, name: nameByCode.get(code) ?? code, composite, valueA, valueB, zA, zB };
    })
    .sort((left, right) => right.composite - left.composite);

  // Map choropleth: min-max normalize composite to 0~100.
  const composites = rows.map((row) => row.composite);
  const min = composites.length ? Math.min(...composites) : 0;
  const max = composites.length ? Math.max(...composites) : 1;
  const span = Math.max(1e-9, max - min);
  const scores = new Map<string, number>();
  for (const row of rows) {
    scores.set(row.code, composites.length <= 1 ? 50 : ((row.composite - min) / span) * 100);
  }

  return { ranked: rows, scores };
}
