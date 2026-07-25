import type { CrossMode, CrossRow } from "@/lib/layers/cross-analysis";

export type CrossOperandInfo = { label: string; unit: string; provider: string };

function shortName(name: string): string {
  return name.replace(/^경상남도\s*/, "");
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "데이터 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
}

/** 두 지표의 순위 격차를 사람이 읽는 표현으로. z=1은 대략 상위 16%. */
function standingOf(z: number): string {
  if (z >= 1) return "매우 높음";
  if (z >= 0.3) return "높음";
  if (z > -0.3) return "보통";
  if (z > -1) return "낮음";
  return "매우 낮음";
}

/**
 * 교차분석 결과 해석문. 일반 순위 결론("상위 3곳은 …")은 두 지표가 서로 어떻게
 * 엇갈리는지를 말해주지 못하므로, 교차 결과에는 전용 문장을 쓴다.
 *
 * gap 모드는 "A는 높은데 B는 낮은" 불일치가 요점이고, both 모드는 "둘 다 높은"
 * 동반 상위가 요점이다. 공공기관 보고서에 그대로 옮길 수 있도록 명사형으로 끝낸다.
 */
export function buildCrossInterpretation(
  ranked: CrossRow[],
  a: CrossOperandInfo,
  b: CrossOperandInfo,
  mode: CrossMode,
): string {
  if (ranked.length === 0) {
    return `${a.label}·${b.label} 두 지표에 모두 값이 있는 행정동이 없어 비교 불가.`;
  }

  const top = ranked[0];
  const names = ranked.slice(0, 3).map((row) => shortName(row.name));

  if (mode === "gap") {
    const head =
      `${a.label}(${a.provider}) 대비 ${b.label}(${b.provider})이 가장 부족한 곳은 ` +
      `${names.join(" · ")} 순.`;
    const detail =
      ` 1위 ${shortName(top.name)}은 ${a.label} ${formatValue(top.valueA, a.unit)}(${standingOf(top.zA)})인 반면 ` +
      `${b.label}은 ${formatValue(top.valueB, b.unit)}(${standingOf(top.zB)})으로 격차 ${top.composite.toFixed(1)}표준편차.`;
    return head + detail;
  }

  const head = `${a.label}(${a.provider})·${b.label}(${b.provider})이 함께 높은 곳은 ${names.join(" · ")} 순.`;
  const detail =
    ` 1위 ${shortName(top.name)}은 ${a.label} ${formatValue(top.valueA, a.unit)}(${standingOf(top.zA)}), ` +
    `${b.label} ${formatValue(top.valueB, b.unit)}(${standingOf(top.zB)}).`;
  return head + detail;
}
