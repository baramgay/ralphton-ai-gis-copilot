import { buildLayerView } from "@/lib/layers/select";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";

/**
 * 지표 **셋 이상**을 겹쳐 본다.
 *
 * 두 지표 교차(crossLayerView)의 both 모드를 N개로 넓힌 것이다. 각 지표를 z-표준화한 뒤
 * **물어본 방향으로 부호를 맞춰** 더한다(낮은 쪽을 물었으면 −z). 그러면 합이 클수록 모든
 * 조건을 고루 만족하는 곳이 된다.
 *
 * gap(대비) 개념은 여기 없다. "A 대비 B"는 두 개일 때만 성립하고, 셋 이상에서는 무엇에서
 * 무엇을 빼는지가 정해지지 않는다. 그런 질의는 기존 2지표 교차가 맡는다.
 */
export type MultiOperand = {
  cube: LayerCube;
  metric: MetricDef;
  metrics: MetricDef[];
  direction: "high" | "low";
};

export type MultiRow = {
  code: string;
  name: string;
  /** 물어본 방향으로 부호를 맞춘 z의 합. 클수록 모든 조건을 만족한다. */
  composite: number;
  /** 지표별 원값·z. 순서는 operands와 같다. */
  values: number[];
  z: number[];
};

export type MultiLayerResult = {
  ranked: MultiRow[];
  /** 지도 채색용(읍면동 키, 0~100). */
  scores: Map<string, number>;
  /** 모든 지표에 값이 있어 비교할 수 있었던 지역 수. */
  comparable: number;
  /** 지표 하나라도 값이 있던 지역 수. comparable과 차이가 크면 밝혀야 한다. */
  total: number;
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
  return { mean, std: Math.sqrt(variance) || 1 };
}

export function multiLayerView(
  operands: readonly MultiOperand[],
  adminLevel: AdminLevel,
  regionFilters: readonly string[] = [],
): MultiLayerResult {
  if (operands.length === 0) {
    return { ranked: [], scores: new Map(), comparable: 0, total: 0 };
  }

  /*
   * 순위는 반드시 ranking(분석 단위)에서 만든다. buildLayerView의 scores는 지도 채색용이라
   * 시군구 단위에서도 읍면동 코드로 키가 잡혀 있다 — 그것으로 순위를 만들면 22개 시군구가
   * 305행으로 부풀고 이름 대신 코드가 화면에 나온다(2지표 교차에서 실제로 겪은 결함).
   */
  const entryMaps = operands.map((operand) => {
    const view = buildLayerView(
      operand.cube,
      operand.metric.key,
      adminLevel,
      monthIndexOf(operand.cube),
      operand.metrics,
    );
    const map = new Map<string, { name: string; value: number }>();
    for (const row of view.ranking) {
      if (row.value != null) map.set(row.code, { name: row.name, value: row.value });
    }
    return map;
  });

  const nameByCode = new Map<string, string>();
  for (const map of entryMaps) {
    for (const [code, entry] of map) if (!nameByCode.has(code)) nameByCode.set(code, entry.name);
  }

  const compactFilters = regionFilters.map((filter) => filter.replace(/\s+/g, "")).filter(Boolean);
  const matchesFilter = (code: string) => {
    if (compactFilters.length === 0) return true;
    const name = (nameByCode.get(code) ?? "").replace(/\s+/g, "");
    return compactFilters.some((filter) => name.includes(filter));
  };

  // 지표가 **전부** 있는 지역만 비교한다. 없는 값을 0으로 채우면 그 지역이 최하위인 것처럼
  // 보인다 — 이 도구는 없는 값을 추정하지 않는다.
  const codes = [...entryMaps[0].keys()]
    .filter((code) => entryMaps.every((map) => map.has(code)))
    .filter(matchesFilter);

  const totalCodes = new Set<string>();
  for (const map of entryMaps) for (const code of map.keys()) if (matchesFilter(code)) totalCodes.add(code);

  const stats = entryMaps.map((map) => standardize(codes.map((code) => map.get(code)!.value)));
  const signs = operands.map((operand) => (operand.direction === "high" ? 1 : -1));

  const ranked: MultiRow[] = codes
    .map((code) => {
      const values = entryMaps.map((map) => map.get(code)!.value);
      const z = values.map((value, index) => (value - stats[index].mean) / stats[index].std);
      const composite = z.reduce((sum, value, index) => sum + value * signs[index], 0);
      return { code, name: nameByCode.get(code) ?? code, composite, values, z };
    })
    .sort((left, right) => right.composite - left.composite);

  const composites = ranked.map((row) => row.composite);
  const min = composites.length ? Math.min(...composites) : 0;
  const max = composites.length ? Math.max(...composites) : 1;
  const span = Math.max(1e-9, max - min);
  const scoreOf = (composite: number) =>
    composites.length <= 1 ? 50 : ((composite - min) / span) * 100;

  const scores = new Map<string, number>();
  if (adminLevel === "sgg") {
    // 지도는 읍면동 폴리곤을 칠하므로 시군구 점수를 소속 읍면동에 펼친다.
    const bySgg = new Map(ranked.map((row) => [row.code, scoreOf(row.composite)]));
    for (const cell of operands[0].cube.cells) {
      const value = bySgg.get(cell.code.slice(0, 5));
      if (value != null) scores.set(cell.code, value);
    }
  } else {
    for (const row of ranked) scores.set(row.code, scoreOf(row.composite));
  }

  return { ranked, scores, comparable: ranked.length, total: totalCodes.size };
}
