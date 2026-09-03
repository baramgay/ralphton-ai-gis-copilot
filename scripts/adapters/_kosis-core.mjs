/**
 * KOSIS e-지방지표 → 레이어 큐브 공용 코드.
 *
 * ## 왜 율·지수 지표만 싣는가
 *
 * KOSIS는 창원시를 **한 행**으로 준다. 앱은 창원을 5개 구로 나눠 다룬다(48121~48129).
 * 그래서 창원 칸에는 시 전체 값이 들어갈 수밖에 없다.
 *
 * 여기서 갈린다. 「주민 만명당 화재 건수」같은 **율**은 시 전체 값을 구의 대표값으로
 * 써도 "우리가 아는 것은 시 수준까지"라는 사실을 적어 두면 정직하다. 그러나 「화재
 * 569건」같은 **건수**를 5개 구에 각각 넣으면 경남 합계가 창원만 5배 부풀어 오른다 —
 * 없는 값을 지어내는 것이다. 그래서 건수 지표는 싣지 않는다.
 *
 * ## 지역 코드
 *
 * KOSIS는 자체 코드(38xxx)를 쓰고 앱은 행정표준코드(48xxx)를 쓴다. 이름으로 맞추면
 * 안 된다 — 「고성군」은 강원(32400)과 경남(38340)에 둘 다 있다. **38 접두사로 먼저
 * 거른 뒤** 이름으로 맞춘다.
 */

const KOSIS_ORIGIN = "https://kosis.kr";

/** KOSIS 경남 시군 코드 → 앱의 행정표준 시군구 코드들. 창원만 1:5다. */
export const KOSIS_TO_SGG = {
  38110: ["48121", "48123", "48125", "48127", "48129"], // 창원시 → 5개 구
  38030: ["48170"], // 진주시
  38050: ["48220"], // 통영시
  38060: ["48240"], // 사천시
  38070: ["48250"], // 김해시
  38080: ["48270"], // 밀양시
  38090: ["48310"], // 거제시
  38100: ["48330"], // 양산시
  38310: ["48720"], // 의령군
  38320: ["48730"], // 함안군
  38330: ["48740"], // 창녕군
  38340: ["48820"], // 고성군 (강원 고성 32400과 다르다)
  38350: ["48840"], // 남해군
  38360: ["48850"], // 하동군
  38370: ["48860"], // 산청군
  38380: ["48870"], // 함양군
  38390: ["48880"], // 거창군
  38400: ["48890"], // 합천군
};

/** 시 전체 값을 그대로 쓰는 구들. 「구별 자료가 아니다」를 화면이 말할 때 쓴다. */
export const CITY_LEVEL_ONLY_SGG = KOSIS_TO_SGG["38110"];

export function readKey(readFileSync, path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))[0];
}

/**
 * 한 표의 최근 `years`개 연도를 받아 온다.
 *
 * `itmId`를 지정하지 않으면 표의 모든 항목이 오는데, 지표 하나에 항목이 여럿인 표가
 * 많다(예: 「화재발생 건수」와 「전년대비 증감」). 부르는 쪽이 어느 항목인지 밝힌다.
 */
export async function fetchKosisTable(options) {
  /*
   * KOSIS는 간헐적으로 40초를 넘긴다. 한 표가 늦었다고 25개 표 전체를 다시 받는 것은
   * 낭비라, 같은 표를 두 번 더 두드려 본다. 마지막까지 실패하면 그대로 던진다 —
   * 실패를 삼키고 빈 레이어를 만들면 "그 지역은 값이 없다"로 인쇄된다.
   */
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchKosisTableOnce(options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchKosisTableOnce({ apiKey, orgId, tblId, itmId, years = 5, fetchImpl = fetch }) {
  const url = new URL(`${KOSIS_ORIGIN}/openapi/Param/statisticsParameterData.do`);
  url.searchParams.set("method", "getList");
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("jsonVD", "Y");
  url.searchParams.set("orgId", orgId);
  url.searchParams.set("tblId", tblId);
  url.searchParams.set("objL1", "ALL");
  url.searchParams.set("itmId", itmId ?? "ALL");
  url.searchParams.set("prdSe", "Y");
  url.searchParams.set("newEstPrdCnt", String(years));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(40_000) });
  const text = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`KOSIS ${tblId} 응답이 JSON이 아닙니다: ${text.slice(0, 160)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`KOSIS ${tblId} 오류: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed;
}

/**
 * KOSIS 행들을 `{ [행정표준 시군구코드]: { [연도]: 값 } }`로 편다.
 *
 * 값이 없는 해는 **넣지 않는다.** 0으로 메우면 "사고가 한 건도 없었다"로 읽힌다.
 */
export function toSggYearMap(rows, { itmId } = {}) {
  const out = {};
  const years = new Set();

  for (const row of rows) {
    if (itmId && row.ITM_ID !== itmId) continue;
    const kosisCode = String(row.C1 ?? "");
    const targets = KOSIS_TO_SGG[kosisCode];
    if (!targets) continue;

    const year = String(row.PRD_DE ?? "");
    if (!/^\d{4}$/.test(year)) continue;

    const raw = row.DT;
    const value = raw === null || raw === undefined || raw === "" || raw === "-" ? null : Number(raw);
    if (value === null || Number.isNaN(value)) continue;

    years.add(year);
    for (const sgg of targets) {
      (out[sgg] ??= {})[year] = value;
    }
  }

  return { bySgg: out, years: [...years].sort() };
}

/**
 * 시군구 값을 행정동 셀로 편다.
 *
 * 원자료가 시군구까지만 있으므로 소속 읍면동은 모두 같은 값을 갖는다. 이것을 읍면동
 * 순위로 세우면 같은 값 30개가 나오므로, 지표에는 반드시 `scope: "sgg"`를 준다.
 */
export function expandToDongCells(regions, bySgg, years, metricKey) {
  const cells = [];
  for (const region of regions) {
    const sgg = String(region.adm_cd2).slice(0, 5);
    const byYear = bySgg[sgg];
    cells.push({
      code: region.adm_cd2,
      name: region.adm_nm,
      // LayerCellSchema는 좌표를 `point` 객체로 받는다. 평평하게 두면 큐브가 통째로 거절된다.
      point: { lat: region.representativePoint.lat, lng: region.representativePoint.lng },
      areaKm2: region.areaSquareKm,
      series: { [metricKey]: years.map((year) => byYear?.[year] ?? null) },
    });
  }
  return cells;
}

/** 연간 자료를 큐브의 월 축에 싣는다. 연말(12월)로 고정하고 한계에 연간임을 적는다. */
export function yearsToMonths(years) {
  return years.map((year) => `${year}-12`);
}
