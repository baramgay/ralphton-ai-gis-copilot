import {
  correlate,
  describeCorrelation,
  findOutliers,
  type CorrelationUnit,
} from "@/lib/analysis/statistics";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import type { CorrelationQueryMatch, OutlierQueryMatch } from "@/lib/layers/resolve-stats-query";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

export type StatsRow = {
  code: string;
  name: string;
  score: number;
  detail: string;
};

export type StatsView = {
  title: string;
  summary: string;
  rows: StatsRow[];
  /** 산식·표본·한계. 화면과 보고서가 같은 문장을 쓴다. */
  notes: string[];
  /** 지도 채색용 0~100 점수. 없으면 지도는 그대로 둔다. */
  scores: Map<string, number> | null;
};

type CubeRef = { cube: LayerCube; metric: MetricDef; metrics: MetricDef[] };

/** 계수를 낼 단위로 큐브를 맞춘다. 시군구 지표는 반드시 접은 뒤 봐야 한다. */
function atUnit(ref: CubeRef, unit: CorrelationUnit): LayerCube {
  return unit === "sgg" ? aggregateToSgg(ref.cube, ref.metrics) : ref.cube;
}

function latestValue(cube: LayerCube, code: string, metricKey: string): number | null {
  const cell = cube.cells.find((candidate) => candidate.code === code);
  if (!cell) return null;
  const series = cell.series[metricKey];
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function formatValue(value: number, unit: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit}`;
}

const UNIT_WORD: Record<CorrelationUnit, string> = { dong: "읍면동", sgg: "시군구" };

/**
 * 두 지표의 관계.
 *
 * 계수 하나만 내지 않는다. **표본 수·단위·뺀 지역**을 함께 적어야 읽을 수 있고,
 * 피어슨과 스피어만이 갈라지면 그 사실 자체가 "한 곳이 끌고 있다"는 신호다.
 */
export function correlationView(
  match: CorrelationQueryMatch,
  a: CubeRef,
  b: CubeRef,
  options: { asksCausation?: boolean } = {},
): StatsView {
  const cubeA = atUnit(a, match.unit);
  const cubeB = atUnit(b, match.unit);

  const codes = cubeA.cells.map((cell) => cell.code);
  const samples = codes.map((code) => ({
    code,
    a: latestValue(cubeA, code, a.metric.key),
    b: latestValue(cubeB, code, b.metric.key),
  }));
  const result = correlate(samples, match.unit);

  const nameOf = new Map(cubeA.cells.map((cell) => [cell.code, cell.name]));
  const rows: StatsRow[] = samples
    .filter((sample) => sample.a != null && sample.b != null)
    .map((sample) => ({
      code: sample.code,
      name: nameOf.get(sample.code) ?? sample.code,
      score: sample.a as number,
      detail: `${match.a.metricLabel} ${formatValue(sample.a as number, a.metric.unit)} · ${match.b.metricLabel} ${formatValue(sample.b as number, b.metric.unit)}`,
    }))
    .sort((x, y) => y.score - x.score);

  const notes: string[] = [];
  const unitWord = UNIT_WORD[match.unit];

  if (result.pearson === null || result.spearman === null) {
    return {
      title: `${match.a.metricLabel} × ${match.b.metricLabel}`,
      summary:
        result.n < 3
          ? `짝이 모두 있는 ${unitWord}가 ${result.n}곳뿐이라 관계를 말할 수 없습니다.`
          : "한쪽 값이 모든 지역에서 같아 관계를 말할 수 없습니다.",
      rows,
      notes: [`표본 ${result.n}개 ${unitWord} · 값이 없어 뺀 곳 ${result.dropped}곳`],
      scores: null,
    };
  }

  const gap = Math.abs(result.pearson - result.spearman);
  notes.push(
    `피어슨 r = ${result.pearson.toFixed(3)} · 스피어만 ρ = ${result.spearman.toFixed(3)} · 표본 ${result.n}개 ${unitWord}${result.dropped > 0 ? ` (값이 없어 ${result.dropped}곳 제외)` : ""}`,
  );
  if (match.unit === "sgg") {
    notes.push(
      "두 지표 중 하나가 시군구까지만 제공되어 시군구 단위로 계산했습니다. 읍면동으로 계산하면 같은 값이 반복 집계되어 표본 수가 부풀려집니다.",
    );
  }
  if (gap >= 0.2) {
    notes.push(
      `두 계수가 ${gap.toFixed(2)}만큼 벌어집니다. 몇몇 지역이 직선 관계를 끌고 있다는 뜻이라, 순위 기반인 스피어만 쪽을 더 믿을 만합니다.`,
    );
  }
  notes.push(
    options.asksCausation
      ? "원인을 물으셨지만 상관계수는 인과를 말하지 않습니다. 두 지표를 동시에 움직이는 제3의 요인(인구 규모·도시화 정도 등)이 있을 수 있습니다."
      : "상관은 인과가 아닙니다. 함께 움직인다는 것이 한쪽이 다른 쪽을 만든다는 뜻은 아닙니다.",
  );

  return {
    title: `${match.a.metricLabel} × ${match.b.metricLabel} 관계`,
    summary: `${result.n}개 ${unitWord}에서 ${describeCorrelation(result.spearman)}입니다 (스피어만 ρ ${result.spearman.toFixed(2)}).`,
    rows,
    notes,
    scores: null,
  };
}

/**
 * 튀는 지역.
 *
 * 중앙값·MAD 기준이다 — 평균±표준편차는 이상치가 자기 기준을 밀어 올려 스스로를 가린다.
 */
export function outlierView(match: OutlierQueryMatch, ref: CubeRef): StatsView {
  const cube = atUnit(ref, match.unit);
  const unitWord = UNIT_WORD[match.unit];

  const samples = cube.cells.map((cell) => ({
    code: cell.code,
    name: cell.name,
    value: latestValue(cube, cell.code, ref.metric.key),
  }));
  const result = findOutliers(samples);

  const notes = [
    `중앙값 ${Number.isNaN(result.median) ? "-" : formatValue(result.median, ref.metric.unit)} 기준, 중앙값절대편차(MAD)의 3배를 넘는 곳입니다.`,
    "평균±표준편차를 쓰지 않는 이유는 크게 튄 값이 표준편차를 함께 키워 스스로를 정상 범위 안으로 넣기 때문입니다.",
    `표본 ${result.n}개 ${unitWord}`,
  ];

  if (result.rows.length === 0) {
    return {
      title: `${match.ref.metricLabel} 이상치`,
      summary:
        result.mad === 0
          ? `${unitWord} 절반 이상이 같은 값이라 튀는 곳을 가릴 수 없습니다(자료가 없는 것이 아닙니다).`
          : `기준을 넘게 튀는 ${unitWord}가 없습니다(자료가 없는 것이 아닙니다).`,
      rows: [],
      notes,
      scores: null,
    };
  }

  const high = result.rows.filter((row) => row.side === "high").length;
  const low = result.rows.length - high;

  return {
    title: `${match.ref.metricLabel} 이상치`,
    summary: `${result.rows.length}개 ${unitWord}가 크게 벗어납니다 (위로 ${high}곳 · 아래로 ${low}곳).`,
    rows: result.rows.map((row) => ({
      code: row.code,
      name: row.name,
      score: row.value,
      detail: `${formatValue(row.value, ref.metric.unit)} · 중앙값에서 ${Math.abs(row.score).toFixed(1)}배(${row.side === "high" ? "위" : "아래"})`,
    })),
    notes,
    scores: null,
  };
}
