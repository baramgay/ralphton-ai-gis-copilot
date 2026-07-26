export type TrendDirection = "rising" | "falling" | "flat";

export type TrendResult = {
  /** 최근 값과 첫 값의 변화율(%). 첫 값이 0이거나 비교 불가면 null. */
  changeRate: number | null;
  /** 최소제곱 기울기(단위/월). 변화의 방향과 속도를 값 크기와 무관하게 본다. */
  slope: number | null;
  direction: TrendDirection;
  first: number | null;
  last: number | null;
  /** 실제 값이 있는 월 수. 2 미만이면 추세를 말할 수 없다. */
  points: number;
};

/**
 * 방향 판정 임계값(%). 월별 지표는 소수점 수준으로 늘 흔들리므로, 이 정도 변화는
 * 추세가 아니라 잡음으로 보고 "보합"으로 부른다.
 */
const FLAT_THRESHOLD_PERCENT = 3;

/**
 * 최근 N개 관측만 잘라 본다. 장기 추세와 최근 흐름이 갈리는 지역이 실제로 적지 않아
 * (카드매출 기준 305개 동 중 44개에서 방향이 반대), 기간을 바꿔 볼 수 있어야 한다.
 *
 * 관측 수 기준이라 큐브의 시점 간격이 월이 아니면 실제 기간과 어긋난다. 월 기간으로
 * 자르려면 sliceRecentMonths를 쓴다.
 */
export function sliceRecent<T>(series: ReadonlyArray<T>, months?: number): ReadonlyArray<T> {
  if (!months || months <= 0 || months >= series.length) return series;
  return series.slice(-months);
}

/** "2025-03" → 0부터 세는 절대 월 번호. 연도를 넘는 간격 계산에 쓴다. */
function monthNumber(label: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

/**
 * 실제 달력 기준으로 최근 N개월 구간만 남긴다.
 *
 * 큐브마다 시점 간격이 다르다 — NH는 12개 월별, KCB 전입·통근은 4개 분기별(종료월 표기)이다.
 * 관측 개수로 자르면 "최근 3개월"을 골라도 KCB는 3개 분기, 곧 9개월치를 보게 되어 화면 라벨과
 * 데이터가 어긋난다. 여기서는 마지막 시점을 기준으로 N개월 안에 드는 관측만 남긴다.
 * 그 결과 KCB에서 3개월을 고르면 관측이 하나뿐이라 추세가 산출되지 않는데, 없는 추세를
 * 지어내는 것보다 낫다.
 */
export function sliceRecentMonths<T>(
  series: ReadonlyArray<T>,
  monthLabels: ReadonlyArray<string>,
  windowMonths?: number,
): ReadonlyArray<T> {
  if (!windowMonths || windowMonths <= 0) return series;
  if (monthLabels.length !== series.length) return sliceRecent(series, windowMonths);

  const numbers = monthLabels.map(monthNumber);
  const last = numbers[numbers.length - 1];
  if (last === null) return sliceRecent(series, windowMonths);

  const earliest = last - (windowMonths - 1);
  const kept: T[] = [];
  numbers.forEach((value, index) => {
    if (value !== null && value >= earliest) kept.push(series[index]);
  });
  return kept.length > 0 ? kept : series.slice(-1);
}

/**
 * 시계열 추세를 낸다.
 *
 * 지금까지는 기준월 한 시점만 보여줘 "이 동의 카드매출이 높다"까지는 알아도 "늘고 있는지
 * 줄고 있는지"는 알 수 없었다. 정책 판단에는 방향이 더 중요할 때가 많다.
 *
 * 변화율은 첫 값 대비 마지막 값으로 크기를 보고, 기울기는 최소제곱으로 흔들림에 덜 휘둘리게
 * 방향을 본다. 결측월은 건너뛰되 원래 위치(월 인덱스)를 유지해 간격이 왜곡되지 않게 한다.
 */
export function computeTrend(series: ReadonlyArray<number | null | undefined>): TrendResult {
  const points: Array<{ x: number; y: number }> = [];
  series.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) points.push({ x: index, y: value });
  });

  if (points.length < 2) {
    const only = points[0]?.y ?? null;
    return { changeRate: null, slope: null, direction: "flat", first: only, last: only, points: points.length };
  }

  const first = points[0].y;
  const last = points[points.length - 1].y;
  const changeRate = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  const slope = denominator === 0 ? null : numerator / denominator;

  // 방향은 변화율로 판정한다(기울기는 단위에 좌우돼 지표 간 비교가 안 된다).
  // 첫 값이 0이라 변화율을 못 낼 때만 기울기 부호를 쓴다.
  let direction: TrendDirection = "flat";
  if (changeRate !== null) {
    if (changeRate > FLAT_THRESHOLD_PERCENT) direction = "rising";
    else if (changeRate < -FLAT_THRESHOLD_PERCENT) direction = "falling";
  } else if (slope !== null && slope !== 0) {
    direction = slope > 0 ? "rising" : "falling";
  }

  return { changeRate, slope, direction, first, last, points: n };
}

const DIRECTION_LABEL: Record<TrendDirection, string> = {
  rising: "증가",
  falling: "감소",
  flat: "보합",
};

/** 추세를 보고서에 그대로 옮길 수 있는 명사형 한 줄로. */
export function describeTrend(trend: TrendResult, metricLabel: string, unit: string): string {
  if (trend.points < 2) return `${metricLabel} 추세 판단 불가(관측 ${trend.points}개월)`;

  const label = DIRECTION_LABEL[trend.direction];
  if (trend.changeRate === null) {
    return `${metricLabel} ${label}(첫 관측값이 0이라 변화율 산출 불가)`;
  }

  const sign = trend.changeRate > 0 ? "+" : "";
  const format = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return (
    `${metricLabel} ${label} · ${trend.points}개월간 ${format(trend.first ?? 0)}${unit} → ` +
    `${format(trend.last ?? 0)}${unit}(${sign}${format(trend.changeRate)}%)`
  );
}
