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
  /** 이 문자열이 이름에 든 지역만 순위에 남긴다(공백 무시). 지도 채색은 그대로 둔다. */
  regionFilter: string | null = null,
): CrossLayerResult {
  const viewA = buildLayerView(a.cube, a.metric.key, adminLevel, monthIndexOf(a.cube), a.metrics);
  const viewB = buildLayerView(b.cube, b.metric.key, adminLevel, monthIndexOf(b.cube), b.metrics);

  /*
   * 순위는 반드시 ranking(분석 단위)에서 만든다.
   *
   * buildLayerView의 scores는 **지도 채색용**이라 시군구 단위에서도 읍면동 코드로 키가
   * 잡혀 있다(같은 시군구 값이 소속 동 수만큼 복제됨). 그것으로 순위를 만들면 22개
   * 시군구가 305행으로 부풀고, 이름을 ranking에서 못 찾아 코드가 그대로 화면에 나온다
   * ("가장 부족한 곳은 4812351500 · 4812351000 …"). prod에서 실제로 그렇게 나왔다.
   */
  const entryOf = (view: typeof viewA) => {
    const map = new Map<string, { name: string; value: number }>();
    for (const row of view.ranking) {
      if (row.value != null) map.set(row.code, { name: row.name, value: row.value });
    }
    return map;
  };
  const entriesA = entryOf(viewA);
  const entriesB = entryOf(viewB);

  const nameByCode = new Map<string, string>();
  for (const [code, entry] of [...entriesA, ...entriesB]) {
    if (!nameByCode.has(code)) nameByCode.set(code, entry.name);
  }

  // 두 지표 모두 값이 있는 지역만(읍면동 질의면 읍면동, 시군구 질의면 시군구).
  const compactFilter = regionFilter?.replace(/\s+/g, "") ?? null;
  const codes = [...entriesA.keys()].filter(
    (code) =>
      entriesB.has(code) &&
      (compactFilter === null ||
        (nameByCode.get(code) ?? "").replace(/\s+/g, "").includes(compactFilter)),
  );
  const aValues = codes.map((code) => entriesA.get(code)!.value);
  const bValues = codes.map((code) => entriesB.get(code)!.value);
  const statA = standardize(aValues);
  const statB = standardize(bValues);

  const rows: CrossRow[] = codes
    .map((code) => {
      const valueA = entriesA.get(code)!.value;
      const valueB = entriesB.get(code)!.value;
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
  const scoreOf = (composite: number) =>
    composites.length <= 1 ? 50 : ((composite - min) / span) * 100;
  if (adminLevel === "sgg") {
    // 지도는 읍면동 폴리곤을 칠하므로, 시군구 점수를 소속 읍면동에 펼쳐 준다.
    const byS = new Map(rows.map((row) => [row.code, scoreOf(row.composite)]));
    for (const cell of a.cube.cells) {
      const value = byS.get(cell.code.slice(0, 5));
      if (value != null) scores.set(cell.code, value);
    }
  } else {
    for (const row of rows) scores.set(row.code, scoreOf(row.composite));
  }

  return { ranked: rows, scores };
}
