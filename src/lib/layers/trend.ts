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
