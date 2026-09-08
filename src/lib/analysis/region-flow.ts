/**
 * 지역 간 이동 흐름 — 「어디서 오고 어디로 가나」.
 *
 * 이동인구 레이어는 「이 동에 몇 명이 들어오는가」만 답한다. 원자료는 **어디서 오는지**를
 * 함께 주는데(유입은 출발 거주지 시군구, 유출은 도착지 시군구) 그 열을 읽고 버려 왔다.
 * `scripts/adapters/skt-flow.mjs`가 그 열로 만든 것을 여기서 화면 모양으로 고른다.
 *
 * 값은 **관외 일평균 인원**이다. 같은 시군구에 사는 사람의 체류는 흐름이 아니라 관내라
 * 어댑터에서 뺐다(2025-12 실측: 김해시 자기쌍 일평균 541,525명 vs 다음 상대 13,066명 —
 * 같이 세면 순위가 아니라 그 도시의 인구를 보게 된다).
 */

export type FlowPartner = { code: string; name: string | null; value: number };

export type FlowRegion = {
  code: string;
  name: string | null;
  inflow: { totals: Array<number | null>; top: Array<FlowPartner[] | null> };
  outflow: { totals: Array<number | null>; top: Array<FlowPartner[] | null> };
};

export type FlowData = {
  months: string[];
  referenceMonth: string;
  topN: number;
  regions: FlowRegion[];
};

export type FlowEntry = {
  code: string;
  /** 이름을 못 찾은 상대는 빈칸으로 두지 않는다 — 빈 줄은 자료가 없는 것으로 읽힌다. */
  label: string;
  value: number;
  /** 관외 총합 대비 비중(%). 상위 몇 곳만 보여 주므로 합이 100이 되지 않는다. */
  share: number | null;
};

export type RegionFlowView = {
  sggCode: string;
  sggName: string;
  month: string;
  inflowTotal: number | null;
  outflowTotal: number | null;
  /** 관외 유입 − 관외 유출. 양수면 밖에서 더 들어온다. */
  netFlow: number | null;
  inbound: FlowEntry[];
  outbound: FlowEntry[];
};

/** 행정동 코드(10자리)든 시군구 코드든 앞 5자리가 시군구다. */
export function sggCodeOf(regionCode: string): string {
  return regionCode.slice(0, 5);
}
function toEntries(
  partners: FlowPartner[] | null | undefined,
  total: number | null,
  limit: number,
): FlowEntry[] {
  if (!partners) return [];
  return partners.slice(0, limit).map((partner) => ({
    code: partner.code,
    label: partner.name ?? `코드 ${partner.code}`,
    value: partner.value,
    share: total && total > 0 ? (partner.value / total) * 100 : null,
  }));
}

/**
 * 선택 지역이 속한 시군구의 흐름을 고른다. 자료가 없으면 null — 부르는 쪽이 그 사실을
 * 화면에 밝힌다(말없이 사라지는 칸이 이 프로젝트에서 가장 나쁜 실패다).
 */
export function selectRegionFlow(
  data: FlowData | null,
  regionCode: string | null,
  limit = 5,
): RegionFlowView | null {
  if (!data || !regionCode) return null;
  const sggCode = sggCodeOf(regionCode);
  const region = data.regions.find((entry) => entry.code === sggCode);
  if (!region) return null;

  /*
   * 기준월이 자료의 달 목록에 없으면 마지막 달로 물러선다. 없는 달을 0으로 채우면
   * 자료 결손이 「흐름 없음」으로 인쇄된다.
   */
  const index =
    data.months.indexOf(data.referenceMonth) >= 0
      ? data.months.indexOf(data.referenceMonth)
      : data.months.length - 1;
  if (index < 0) return null;

  const inflowTotal = region.inflow.totals[index] ?? null;
  const outflowTotal = region.outflow.totals[index] ?? null;

  return {
    sggCode,
    sggName: region.name ?? `코드 ${sggCode}`,
    month: data.months[index]!,
    inflowTotal,
    outflowTotal,
    netFlow:
      inflowTotal === null || outflowTotal === null
        ? null
        : Math.round((inflowTotal - outflowTotal) * 10) / 10,
    inbound: toEntries(region.inflow.top[index], inflowTotal, limit),
    outbound: toEntries(region.outflow.top[index], outflowTotal, limit),
  };
}

/* ------------------------------------------------------------------ *
 * 돈 흐름 — 카드매출이 어디서 와서 쓰이나
 * ------------------------------------------------------------------ */

/**
 * 사람 흐름과 같은 모양이지만 다른 자료다. 유출 파일이 없어 **들어오는 쪽만**
 * 있다 — 없는 쪽을 null 배열로 채우면 「그 달 자료 없음」으로 읽히므로, 모양에
 * outflow를 두지 않는다. 단위는 백만원(카드매출 지표와 같아 값을 맞댈 수 있다).
 */
export type MoneyFlowRegion = {
  code: string;
  name: string | null;
  inflow: {
    totals: Array<number | null>;
    top: Array<FlowPartner[] | null>;
    /** 관내(같은 시군구 거주자) 합계. 관외 비중의 분모다. */
    intra: Array<number | null>;
  };
};

export type MoneyFlowData = {
  months: string[];
  referenceMonth: string;
  regions: MoneyFlowRegion[];
};

export type MoneyFlowView = {
  sggCode: string;
  sggName: string;
  month: string;
  /** 관외에서 와서 쓰인 돈(일평균 백만원). */
  outsideTotal: number | null;
  /** 같은 시군구 거주자가 쓴 돈(일평균 백만원). */
  intraTotal: number | null;
  /** 관외 ÷ (관외+관내) × 100. 분모가 없으면 null이다. */
  outsideShare: number | null;
};

/**
 * 선택 지역이 속한 시군구의 돈 흐름을 고른다. 사람 흐름과 같은 규약이다 —
 * 자료가 없으면 null이라 부르는 쪽이 밝힌다.
 */
export function selectMoneyFlow(
  data: MoneyFlowData | null,
  regionCode: string | null,
): MoneyFlowView | null {
  if (!data || !regionCode) return null;
  const sggCode = sggCodeOf(regionCode);
  const region = data.regions.find((entry) => entry.code === sggCode);
  if (!region) return null;

  const index =
    data.months.indexOf(data.referenceMonth) >= 0
      ? data.months.indexOf(data.referenceMonth)
      : data.months.length - 1;
  if (index < 0) return null;

  const outsideTotal = region.inflow.totals[index] ?? null;
  const intraTotal = region.inflow.intra[index] ?? null;
  const denominator =
    outsideTotal !== null && intraTotal !== null ? outsideTotal + intraTotal : null;
  return {
    sggCode,
    sggName: region.name ?? `코드 ${sggCode}`,
    month: data.months[index]!,
    outsideTotal,
    intraTotal,
    outsideShare:
      denominator !== null && denominator > 0
        ? Math.round((outsideTotal! / denominator) * 1000) / 10
        : null,
  };
}

/** 목록은 사람 흐름과 같은 모양으로 낸다. 분모는 관외 총합이다. */
export function moneyFlowEntries(
  data: MoneyFlowData | null,
  regionCode: string | null,
  limit = 5,
): FlowEntry[] {
  if (!data || !regionCode) return [];
  const region = data.regions.find((entry) => entry.code === sggCodeOf(regionCode));
  if (!region) return [];
  const index =
    data.months.indexOf(data.referenceMonth) >= 0
      ? data.months.indexOf(data.referenceMonth)
      : data.months.length - 1;
  if (index < 0) return [];
  return toEntries(region.inflow.top[index], region.inflow.totals[index] ?? null, limit);
}
