/**
 * 두 지표 사이의 관계와 튀는 지역을 본다.
 *
 * 이 도구는 지금까지 「순위」와 「교차 합성점수」만 냈다. 둘 다 "어디가 높은가"는 말해도
 * "두 지표가 같이 움직이는가"·"저 한 곳이 유난한가"는 말하지 못한다. 정책 판단에서
 * 실제로 묻는 것은 뒤쪽이다.
 */

export type CorrelationUnit = "dong" | "sgg";

export type CorrelationResult = {
  /** 짝이 모두 있는 관측 수. 이것을 밝히지 않으면 어떤 계수도 읽을 수 없다. */
  n: number;
  /** 피어슨 r — 직선 관계의 세기. 이상치 하나에 크게 흔들린다. */
  pearson: number | null;
  /** 스피어만 ρ — 순위 관계의 세기. 곡선·이상치에 견딘다. */
  spearman: number | null;
  /** 계수를 낸 단위. 시군구 지표가 끼면 시군구로 내려간다. */
  unit: CorrelationUnit;
  /** 값이 한쪽이라도 없어 뺀 지역 수. 조용히 빠지면 표본이 무엇인지 알 수 없다. */
  dropped: number;
};

/**
 * 같은 값이 여럿일 때 평균 순위를 준다.
 *
 * 단순히 정렬 위치를 쓰면 동점이 임의 순서로 갈라져 스피어만이 실제보다 강해진다.
 * 시군구까지만 있는 지표는 읍면동 셀이 통째로 동점이라 이 처리가 없으면 값이 무너진다.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    // i..j가 동점 구간. 1부터 세는 순위의 평균을 나눠 갖는다.
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = shared;
    i = j + 1;
  }
  return ranks;
}

function pearsonOf(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  // 한쪽이 상수면 관계를 말할 수 없다(0으로 나눈다). null은 "0"이 아니라 "모른다"다.
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

export type PairedSample = {
  code: string;
  a: number | null;
  b: number | null;
};

/**
 * 짝이 모두 있는 관측만 남겨 계수를 낸다.
 *
 * ⚠️ `unit`을 부르는 쪽이 정한다. 시군구까지만 있는 지표를 읍면동 305칸으로 상관을 내면
 * **같은 값이 복제된 표본**이라 n이 14배로 부풀고, 그 n으로 유의성을 말하면 거짓이 된다.
 * 한쪽이라도 시군구 지표면 시군구로 접은 뒤 부른다.
 */
export function correlate(samples: readonly PairedSample[], unit: CorrelationUnit): CorrelationResult {
  const xs: number[] = [];
  const ys: number[] = [];
  let dropped = 0;

  for (const sample of samples) {
    if (sample.a == null || sample.b == null || !Number.isFinite(sample.a) || !Number.isFinite(sample.b)) {
      dropped += 1;
      continue;
    }
    xs.push(sample.a);
    ys.push(sample.b);
  }

  return {
    n: xs.length,
    pearson: pearsonOf(xs, ys),
    spearman: xs.length < 3 ? null : pearsonOf(averageRanks(xs), averageRanks(ys)),
    unit,
    dropped,
  };
}

/**
 * 관계의 세기를 말로. 계수만 던지면 읽는 사람이 제 마음대로 해석한다.
 *
 * 경계는 사회과학에서 흔히 쓰는 관례다(±0.1/0.3/0.5). 관례라는 것을 밝혀야 하는 이유는
 * 이것이 자연법칙이 아니라 약속이기 때문이다.
 */
export function describeCorrelation(r: number): string {
  const magnitude = Math.abs(r);
  const direction = r > 0 ? "같이 높아지는" : "반대로 움직이는";
  if (magnitude < 0.1) return "사실상 관계가 없습니다";
  if (magnitude < 0.3) return `약하게 ${direction} 경향`;
  if (magnitude < 0.5) return `뚜렷하게 ${direction} 경향`;
  return `강하게 ${direction} 경향`;
}

export type OutlierRow = {
  code: string;
  name: string;
  value: number;
  /** 중앙값에서 MAD 몇 배만큼 떨어져 있는가. 부호가 방향이다. */
  score: number;
  side: "high" | "low";
};

export type OutlierResult = {
  median: number;
  /** 중앙값 절대편차. 0이면 값이 거의 한 점에 몰려 있어 이상치를 말할 수 없다. */
  mad: number;
  rows: OutlierRow[];
  n: number;
};

/**
 * 튀는 지역을 찾는다 — 중앙값과 MAD 기준.
 *
 * 평균±표준편차를 쓰지 않는 이유는, **이상치가 자기가 기준으로 쓰이는 평균과 표준편차를
 * 직접 밀어 올리기 때문**이다. 한 곳이 크게 튀면 표준편차가 같이 커져 그 곳이 정상
 * 범위 안으로 들어온다(가리려는 것이 자기를 가린다). 중앙값과 MAD는 절반이 오염되기
 * 전까지 흔들리지 않는다.
 *
 * 0.6745는 정규분포에서 MAD를 표준편차와 같은 눈금으로 맞추는 상수라, `threshold`를
 * "표준편차 몇 배"처럼 읽을 수 있다.
 */
export function findOutliers(
  samples: readonly { code: string; name: string; value: number | null }[],
  threshold = 3,
): OutlierResult {
  const present = samples.filter(
    (s): s is { code: string; name: string; value: number } =>
      s.value != null && Number.isFinite(s.value),
  );
  const values = present.map((s) => s.value).sort((a, b) => a - b);
  if (values.length < 4) return { median: Number.NaN, mad: 0, rows: [], n: values.length };

  const median = quantile(values, 0.5);
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);

  /*
   * MAD가 0이면 절반 넘는 지역이 같은 값이라는 뜻이다(시군구 지표를 읍면동으로 편 경우가
   * 그렇다). 그때 나누면 무한대가 나와 모든 지역이 이상치가 된다 — 빈 목록을 돌린다.
   */
  if (mad === 0) return { median, mad: 0, rows: [], n: values.length };

  const rows: OutlierRow[] = [];
  for (const sample of present) {
    const score = (0.6745 * (sample.value - median)) / mad;
    if (Math.abs(score) < threshold) continue;
    rows.push({
      code: sample.code,
      name: sample.name,
      value: sample.value,
      score,
      side: score > 0 ? "high" : "low",
    });
  }
  rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return { median, mad, rows, n: values.length };
}

/** 정렬된 배열의 분위수(선형 보간). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
