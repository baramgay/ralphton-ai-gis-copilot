import {
  correlate,
  describeCorrelation,
  findOutliers,
  type CorrelationUnit,
} from "@/lib/analysis/statistics";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import {
  collapseReplicatedDistricts,
  describeCollapse,
  districtParentCity,
} from "@/lib/layers/independent-observations";
import type { CorrelationQueryMatch, OutlierQueryMatch } from "@/lib/layers/resolve-stats-query";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

export type StatsRow = {
  code: string;
  name: string;
  score: number;
  detail: string;
  /** 같은 값을 나눠 가져 한 줄로 접힌 지역 수(창원 5개 구 등). */
  sharedCount?: number;
};

export type StatsView = {
  title: string;
  summary: string;
  rows: StatsRow[];
  /** 산식·표본·한계. 화면과 보고서가 같은 문장을 쓴다. */
  notes: string[];
  /** 지도 채색용 0~100 점수. 없으면 지도는 그대로 둔다. */
  scores: Map<string, number> | null;
  /** 결과 개수 옆에 붙는 단위. 없으면 화면이 활성 레이어 기준으로 잘못 추측한다. */
  unitWord: string;
};

type CubeRef = { cube: LayerCube; metric: MetricDef; metrics: MetricDef[] };

/** 계수를 낼 단위로 큐브를 맞춘다. 시군구 지표는 반드시 접은 뒤 봐야 한다. */
function atUnit(ref: CubeRef, unit: CorrelationUnit): LayerCube {
  return unit === "sgg" ? aggregateToSgg(ref.cube, ref.metrics) : ref.cube;
}

/**
 * 마지막 유효 관측 — **값과 함께 그게 언제인지도** 돌린다.
 *
 * 값만 돌리면 축마다 최신 시점이 달라도 알 길이 없다. 실제로 재정자립도는 2024-12가
 * 최신이고 화재 발생률은 2025-12라, 「재정자립도 × 화재」 상관은 **한 해 어긋난 두 값의
 * 상관**이다. 한 지표 안에서도 갈린다 — 뺑소니율은 함양군 11개 읍면만 2024-12가 최신이다.
 */
function latestPoint(
  cube: LayerCube,
  code: string,
  metricKey: string,
): { value: number; month: string } | null {
  const cell = cube.cells.find((candidate) => candidate.code === code);
  if (!cell) return null;
  const series = cell.series[metricKey];
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value != null && Number.isFinite(value)) {
      return { value, month: cube.months[i] ?? cube.referenceMonth };
    }
  }
  return null;
}

function formatValue(value: number, unit: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit}`;
}

const UNIT_WORD: Record<CorrelationUnit, string> = { dong: "읍면동", sgg: "시군구" };

/** 접힌 묶음이면 시 이름으로, 아니면 원래 이름 그대로. */
function displayName(name: string, shared: number): string {
  if (shared <= 1) return name;
  return districtParentCity(name) ?? name;
}

function withSharedNote(detail: string, shared: number): string {
  return shared > 1 ? `${detail} · ${shared}개 구 공통값(구별 자료 없음)` : detail;
}

/**
 * 관측이 여러 달에 걸쳐 있으면 그 사실을 적는다.
 *
 * 「최신값끼리 비교」는 최신이 같은 달일 때만 성립한다. 아니면 화면이 말하지 않은 채
 * 서로 다른 시점을 견준다.
 */
function monthNotes(used: readonly (string | null)[], label: string, unitWord: string): string[] {
  const months = [...new Set(used.filter((month): month is string => month != null))].sort();
  if (months.length <= 1) return [];
  const oldest = months[0];
  const newest = months[months.length - 1];
  const laggards = used.filter((month) => month != null && month !== newest).length;
  return [
    `${label}은 ${unitWord}마다 최신 시점이 다릅니다 — ${laggards}곳이 ${oldest} 값이고 나머지는 ${newest} 값입니다. 서로 다른 시점을 한 줄에 놓고 봅니다.`,
  ];
}

/**
 * 두 지표의 관계.
 *
 * 계수 하나만 내지 않는다. **표본 수·단위·뺀 지역**을 함께 적어야 읽을 수 있고,
 * 피어슨과 스피어만이 갈라지면 그 사실 자체가 "한 곳이 끌고 있다"는 신호다.
 *
 * ⚠️ 표본은 **칸 수가 아니라 독립 관측 수**다. 창원 5개 구는 KOSIS가 시 한 행만 주어
 * 값이 복제된 것이라 1곳으로 센다(`independent-observations.ts`에 실측 표).
 */
export function correlationView(
  match: CorrelationQueryMatch,
  a: CubeRef,
  b: CubeRef,
  options: { asksCausation?: boolean } = {},
): StatsView {
  const cubeA = atUnit(a, match.unit);
  const cubeB = atUnit(b, match.unit);

  const nameOf = new Map(cubeA.cells.map((cell) => [cell.code, cell.name]));
  const raw = cubeA.cells.map((cell) => {
    const pointA = latestPoint(cubeA, cell.code, a.metric.key);
    const pointB = latestPoint(cubeB, cell.code, b.metric.key);
    return {
      code: cell.code,
      name: nameOf.get(cell.code) ?? cell.code,
      a: pointA?.value ?? null,
      b: pointB?.value ?? null,
      monthA: pointA?.month ?? null,
      monthB: pointB?.month ?? null,
    };
  });

  /*
   * 자치구로 복제된 값은 한 관측이다. 읍면동 단위에서는 접지 않는다 — 같은 시의 두 동이
   * 우연히 같은 값을 가질 수 있고, 그 둘은 실제로 따로 측정된 서로 다른 관측이다.
   */
  const grouped =
    match.unit === "sgg"
      ? collapseReplicatedDistricts(
          raw,
          (row) => row.name,
          (row) => [row.a, row.b],
        )
      : { items: raw, sharedCount: new Map(raw.map((row) => [row, 1])), collapsed: [] };

  const result = correlate(grouped.items, match.unit);

  const paired = grouped.items.filter((row) => row.a != null && row.b != null);
  const rows: StatsRow[] = paired
    .map((row) => {
      const shared = grouped.sharedCount.get(row) ?? 1;
      return {
        code: row.code,
        name: displayName(row.name, shared),
        score: row.a as number,
        detail: withSharedNote(
          `${match.a.metricLabel} ${formatValue(row.a as number, a.metric.unit)} · ${match.b.metricLabel} ${formatValue(row.b as number, b.metric.unit)}`,
          shared,
        ),
        ...(shared > 1 ? { sharedCount: shared } : {}),
      };
    })
    .sort((x, y) => y.score - x.score);

  const notes: string[] = [];
  const unitWord = UNIT_WORD[match.unit];
  const collapseNote = describeCollapse(grouped.collapsed);

  if (result.pearson === null || result.spearman === null) {
    return {
      title: `${match.a.metricLabel} × ${match.b.metricLabel}`,
      summary:
        result.n < 3
          ? `짝이 모두 있는 ${unitWord}가 ${result.n}곳뿐이라 관계를 말할 수 없습니다.`
          : "한쪽 값이 모든 지역에서 같아 관계를 말할 수 없습니다.",
      rows,
      unitWord,
      notes: [
        `표본 ${result.n}개 ${unitWord} · 값이 없어 뺀 곳 ${result.dropped}곳`,
        ...(collapseNote ? [collapseNote] : []),
      ],
      scores: null,
    };
  }

  const gap = Math.abs(result.pearson - result.spearman);
  notes.push(
    `피어슨 r = ${result.pearson.toFixed(3)} · 스피어만 ρ = ${result.spearman.toFixed(3)} · 표본 ${result.n}개 ${unitWord}${result.dropped > 0 ? ` (값이 없어 ${result.dropped}곳 제외)` : ""}`,
  );
  if (collapseNote) notes.push(collapseNote);
  if (match.unit === "sgg") {
    notes.push(
      "두 지표 중 하나가 시군구까지만 제공되어 시군구 단위로 계산했습니다. 읍면동으로 계산하면 같은 값이 반복 집계되어 표본 수가 부풀려집니다.",
    );
  }

  /*
   * 축마다 최신 시점을 따로 집으므로 「2024년 값 × 2025년 값」이 될 수 있다. 실제로
   * 재정자립도(2024-12) × 화재 발생률(2025-12)이 그렇다. 계수를 못 내는 문제가 아니라
   * **무엇과 무엇을 견줬는지 화면이 말하지 않는** 문제라, 시점을 적는다.
   */
  const monthsA = [...new Set(paired.map((row) => row.monthA).filter(Boolean))];
  const monthsB = [...new Set(paired.map((row) => row.monthB).filter(Boolean))];
  if (monthsA.length === 1 && monthsB.length === 1) {
    notes.push(
      monthsA[0] === monthsB[0]
        ? `두 지표 모두 ${monthsA[0]} 값입니다.`
        : `기준 시점이 다릅니다 — ${match.a.metricLabel}은 ${monthsA[0]}, ${match.b.metricLabel}은 ${monthsB[0]} 값입니다. 두 지표의 최신 자료가 같은 달이 아니라 그렇습니다.`,
    );
  }
  notes.push(
    ...monthNotes(
      paired.map((row) => row.monthA),
      match.a.metricLabel,
      unitWord,
    ),
  );
  notes.push(
    ...monthNotes(
      paired.map((row) => row.monthB),
      match.b.metricLabel,
      unitWord,
    ),
  );

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
    unitWord,
    notes,
    scores: null,
  };
}

/**
 * 튀는 지역.
 *
 * 중앙값·MAD 기준이다 — 평균±표준편차는 이상치가 자기 기준을 밀어 올려 스스로를 가린다.
 *
 * ⚠️ 여기서도 표본은 독립 관측이다. 복제된 5점은 판정을 **양쪽으로** 뒤집는다 —
 * 재정자립도에서는 중앙값을 자기 쪽으로 끌어 창원 스스로를 정상으로 만들고(22점 이상치
 * 없음 → 18점 창원 3.3배), 인구 천명당 병상에서는 반대로 MAD를 3.15 → 1.20으로 무너뜨려
 * 22곳 중 8곳을 이상치로 인쇄한다. `MAD === 0` 가드는 0만 막지 0 근처의 붕괴는 못 막는다.
 */
export function outlierView(match: OutlierQueryMatch, ref: CubeRef): StatsView {
  const cube = atUnit(ref, match.unit);
  const unitWord = UNIT_WORD[match.unit];

  const raw = cube.cells.map((cell) => {
    const point = latestPoint(cube, cell.code, ref.metric.key);
    return {
      code: cell.code,
      name: cell.name,
      value: point?.value ?? null,
      month: point?.month ?? null,
    };
  });
  const grouped =
    match.unit === "sgg"
      ? collapseReplicatedDistricts(
          raw,
          (row) => row.name,
          (row) => [row.value],
        )
      : { items: raw, sharedCount: new Map(raw.map((row) => [row, 1])), collapsed: [] };
  const sharedByCode = new Map(
    grouped.items.map((row) => [row.code, grouped.sharedCount.get(row) ?? 1]),
  );
  const result = findOutliers(grouped.items);
  const collapseNote = describeCollapse(grouped.collapsed);

  const notes = [
    `중앙값 ${Number.isNaN(result.median) ? "-" : formatValue(result.median, ref.metric.unit)} 기준, 중앙값절대편차(MAD)의 3배를 넘는 곳입니다.`,
    "평균±표준편차를 쓰지 않는 이유는 크게 튄 값이 표준편차를 함께 키워 스스로를 정상 범위 안으로 넣기 때문입니다.",
    `표본 ${result.n}개 ${unitWord}`,
    ...(collapseNote ? [collapseNote] : []),
    ...monthNotes(
      grouped.items.filter((row) => row.value != null).map((row) => row.month),
      match.ref.metricLabel,
      unitWord,
    ),
  ];

  if (result.rows.length === 0) {
    return {
      title: `${match.ref.metricLabel} 이상치`,
      summary:
        result.mad === 0
          ? `${unitWord} 절반 이상이 같은 값이라 튀는 곳을 가릴 수 없습니다(자료가 없는 것이 아닙니다).`
          : `기준을 넘게 튀는 ${unitWord}가 없습니다(자료가 없는 것이 아닙니다).`,
      rows: [],
      unitWord,
      notes,
      scores: null,
    };
  }

  const high = result.rows.filter((row) => row.side === "high").length;
  const low = result.rows.length - high;

  return {
    title: `${match.ref.metricLabel} 이상치`,
    summary: `${result.rows.length}개 ${unitWord}가 크게 벗어납니다 (위로 ${high}곳 · 아래로 ${low}곳).`,
    rows: result.rows.map((row) => {
      const shared = sharedByCode.get(row.code) ?? 1;
      return {
        code: row.code,
        name: displayName(row.name, shared),
        score: row.value,
        detail: withSharedNote(
          `${formatValue(row.value, ref.metric.unit)} · 중앙값에서 ${Math.abs(row.score).toFixed(1)}배(${row.side === "high" ? "위" : "아래"})`,
          shared,
        ),
        ...(shared > 1 ? { sharedCount: shared } : {}),
      };
    }),
    unitWord,
    notes,
    scores: null,
  };
}
