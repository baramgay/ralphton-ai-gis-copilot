import type { Facility } from "@/lib/domain/schemas";
import { matchPlacesInText, type MatchedPlace } from "@/lib/geo/place-index";

import { DISTRICT_ALIASES, DISTRICT_LABELS, SGG_CUES } from "./query-catalog-meta";

export type SpatialCue =
  | "nearby"
  | "radius"
  | "distance"
  | "compare"
  | "map"
  | "rank"
  | "detail";

export type MetricCue =
  | "scarcity"
  | "elderly"
  | "growth"
  | "decline"
  | "singleHousehold"
  | "death"
  | "birth"
  | "naturalDecrease"
  | "naturalIncrease"
  | "density"
  | "population"
  | "households"
  | "youth"
  | "medical"
  | "facilityList"
  | "pharmacy"
  | "night"
  | "weekend"
  | "kakaoLive";

export type QuerySignals = {
  raw: string;
  normalized: string;
  districts: string[];
  /** Matched administrative dongs (from place-index gazetteer). */
  dongs: MatchedPlace[];
  radiusKm: 1 | 2 | 3 | null;
  facilityTypes: Facility["type"][];
  spatial: Set<SpatialCue>;
  metrics: Set<MetricCue>;
  includePharmacy: boolean;
  polarityHigh: boolean;
  polarityLow: boolean;
  freePlaceQuery: string | null;
  /** "시군구별"처럼 시군구 단위를 명시적으로 요구했는가. */
  wantsDistrictLevel: boolean;
  wantsBest: boolean;
  wantsWorst: boolean;
  /** Direction for nearest/farthest-facility distance ranking ("가까운" vs "먼"). */
  nearestDirection: "near" | "far";
};

const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:km|키로|킬로미터|킬로|ｋｍ)/gi;

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractDistricts(text: string): string[] {
  const labels = [...DISTRICT_LABELS].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  const positions: number[] = [];
  let remaining = text;

  for (const label of labels) {
    const at = remaining.indexOf(label);
    if (at < 0) continue;
    // Map position back to original string roughly via first occurrence of label
    const originAt = text.indexOf(label);
    found.push(label);
    positions.push(originAt >= 0 ? originAt : at);
    remaining = remaining.split(label).join(" ");
  }

  // Aliases: "김해" → "김해시", "창원" → "창원시 의창구"
  const aliasEntries = Object.entries(DISTRICT_ALIASES).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [alias, full] of aliasEntries) {
    if (found.includes(full)) continue;
    const at = remaining.indexOf(alias);
    if (at < 0) continue;
    const originAt = text.indexOf(alias);
    found.push(full);
    positions.push(originAt >= 0 ? originAt : at);
    remaining = remaining.split(alias).join(" ");
  }

  // Preserve mention order in the original query (important for compare A vs B)
  return found
    .map((label, index) => ({ label, pos: positions[index] ?? 0 }))
    .sort((a, b) => a.pos - b.pos || a.label.localeCompare(b.label))
    .map((item) => item.label);
}

/**
 * Well-known non-Gyeongnam place names. Used to surface an out-of-scope notice
 * instead of silently falling through to an unscoped province-wide ranking
 * when the query names a place this app has no data for (e.g. "해운대구 인구").
 */
const OUT_OF_SCOPE_PLACE_HINTS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "충청",
  "전북",
  "전남",
  "전라",
  "경북",
  "제주",
  "해운대",
] as const;

/** Returns the first out-of-scope place hint mentioned in the text, or null. */
export function detectOutOfScopePlace(text: string): string | null {
  return OUT_OF_SCOPE_PLACE_HINTS.find((hint) => text.includes(hint)) ?? null;
}

/**
 * 이 도구에 아예 없는 **차원**을 묻는 표현.
 *
 * 큐브는 월 단위 집계라 요일·시간대 축이 없다. 그런데 "주말에 사람 몰리는 곳"이
 * 12개월 인구 증감률로 답하고 있었다(prod 실측) — "몰리"가 인구 증가 신호로 등록돼
 * 있어서다. 지역명이 범위 밖이면 멈추듯, 차원이 범위 밖이어도 멈춰야 한다.
 * 없는 축을 물었는데 있는 축으로 답하면 사용자는 그것이 답인 줄 안다.
 *
 * 단, 시설 검색은 영업시간을 실제로 걸러 준다("주말 여는 약국"). 그건 통과시킨다.
 */
const NO_TIME_AXIS_CUES = [
  "주말",
  "평일",
  "토요일",
  "일요일",
  "요일",
  "시간대",
  "시간별",
  "출근 시간",
  "퇴근 시간",
  "새벽",
  "점심시간",
] as const;

/** 영업시간 필터가 실제로 있는 경로(시설 검색)를 가리키는 말. */
const FACILITY_CUES = ["약국", "병원", "의원", "치과", "한의원", "응급", "진료", "문 여는", "여는"];

export function detectUnsupportedDimension(text: string): string | null {
  if (FACILITY_CUES.some((cue) => text.includes(cue))) return null;
  return NO_TIME_AXIS_CUES.find((cue) => text.includes(cue)) ?? null;
}

/**
 * 이 도구에 위치 데이터가 없는 **시설**.
 *
 * "1km 안에 편의점 많은 동"이 "1km 반경 **의료기관** 수를 비교했습니다"로 답하고 있었다
 * (prod 실측). 시설 사전이 의료기관 8종뿐이라 매칭이 비면 반경검색이 의료기관 전체를
 * 기본값으로 세는 탓이다. 물어본 것과 다른 시설을 세어 놓고 그 사실을 안내에 적어도,
 * 사용자는 자기가 물은 편의점 답을 받은 줄 안다.
 *
 * "학교 근처 소비 많은 동"처럼 큐브 지표에 붙은 공간 조건도 여기서 걸린다 — 임의 지점과의
 * 거리 조인이 아예 없어서 그 조건이 통째로 무시되고 무조건부 순위와 같은 답이 나온다.
 *
 * 지명·행정용어와 겹칠 수 있는 말(시장·공원 등)은 일부러 뺐다. 못 잡는 것보다 잘못
 * 잡는 것이 나쁘다.
 */
const NO_POI_DATA = [
  "편의점",
  "대형마트",
  "마트",
  "카페",
  "초등학교",
  "중학교",
  "고등학교",
  "대학교",
  "학교",
  "어린이집",
  "유치원",
  "은행",
  "주유소",
  "도서관",
  "터미널",
  "군부대",
  "헬스장",
  "미용실",
  "음식점",
  "식당",
  "노래방",
  "영화관",
] as const;

/**
 * 비슷한 지표는 있지만 **물어본 그것**은 없는 경우.
 *
 * 아무 지표도 없으면 도구가 정직하게 못 하겠다고 말한다. 문제는 비슷한 것이 있을 때다 —
 * "1인가구 많은 동"이 "가구"에 걸려 세대수(총 가구 수)로 답했다(prod 실측). 도시 동이
 * 둘 다 1위라 답이 그럴듯해 보이는 것이 더 나쁘다. "출산율"도 출생 **수**로 답했다 —
 * 인구 많은 동네가 그냥 이긴다.
 *
 * 막기만 하지 않고 가진 것을 함께 알려, 사용자가 대신 물을지 고르게 한다.
 */
const NEAR_MISS_METRICS: Array<{ asked: string[]; label: string; have: string }> = [
  {
    asked: ["출산율", "합계출산율", "출생률"],
    label: "출산율",
    have: "기준월 출생 수(건수)",
  },
];

/**
 * 공공 도구가 실제로 답할 수 있는데 큐브 트리거가 먼저 가로채는 말.
 *
 * "1인가구 많고 소득 낮은 동"이 세대수(총 가구 수)로 답했다(prod 실측) — 큐브의 "가구"
 * 트리거가 "1인가구" 안의 "가구"에 걸려서다. 1인가구 비율은 rankSingleHouseholdRisk로
 * 멀쩡히 있는 지표다. 없는 것이 아니라 **가로채인 것**이라, 막을 게 아니라 비켜 줘야 한다.
 */
const PUBLIC_FIRST_CUES = ["1인가구", "1인 가구", "일인가구", "단독가구", "단독세대", "독거"];

export function prefersPublicTool(text: string): boolean {
  return PUBLIC_FIRST_CUES.some((cue) => text.includes(cue));
}

export function detectMissingMetric(text: string): { label: string; have: string } | null {
  const hit = NEAR_MISS_METRICS.find((entry) => entry.asked.some((cue) => text.includes(cue)));
  return hit ? { label: hit.label, have: hit.have } : null;
}

/**
 * 이 가드는 **위치·거리**를 물을 때만 걸어야 한다.
 *
 * 처음엔 낱말만 보고 막았다가 "음식점 비중 높은 동"·"카페 상권 발달한 동"·"편의점 비중
 * 높은 동"·"주유소 비중 높은 동" 넷을 함께 막아 버렸다(값 대조 46 → 42). 이것들은
 * NH 생활업종 **소비 비중** 지표로 멀쩡히 답하던 질의다. 없는 것은 그 업종의 *위치*이지
 * 그 업종에 대한 *지표*가 아니다.
 */
const PROXIMITY_CUES = ["반경", "근처", "인근", "주변", "안에", "이내", "km", "킬로", "키로", "m 안"];

export function detectUnsupportedFacility(text: string): string | null {
  // 의료기관을 함께 물었으면 그쪽은 실제로 답할 수 있으므로 막지 않는다.
  if (FACILITY_CUES.some((cue) => text.includes(cue))) return null;
  if (!PROXIMITY_CUES.some((cue) => text.includes(cue))) return null;
  return NO_POI_DATA.find((name) => text.includes(name)) ?? null;
}

function extractRadiusKm(text: string): 1 | 2 | 3 | null {
  for (const match of text.matchAll(RADIUS_PATTERN)) {
    const value = Number.parseFloat(match[1]);
    if (value === 1 || value === 2 || value === 3) return value;
  }
  // colloquial
  if (includesAny(text, ["1키로", "1킬로", "일키로"])) return 1;
  if (includesAny(text, ["2키로", "2킬로", "이키로"])) return 2;
  if (includesAny(text, ["3키로", "3킬로", "삼키로"])) return 3;
  if (
    includesAny(text, ["반경", "접근성", "인근", "주변", "안에", "이내"]) &&
    includesAny(text, ["병원", "의료", "의원", "시설", "약국"])
  ) {
    return 2;
  }
  return null;
}

function extractFacilityTypes(text: string): Facility["type"][] {
  const pairs: Array<[Facility["type"], string[]]> = [
    ["종합병원", ["종합병원", "대학병원", "상급종합", "상급병원"]],
    ["요양병원", ["요양병원", "요양원"]],
    ["치과의원", ["치과의원", "치과", "덴탈"]],
    ["한의원", ["한의원", "한방", "한의"]],
    ["보건소", ["보건소", "보건지소", "보건센터"]],
    ["약국", ["약국", "약방", "처방전"]],
    ["의원", ["의원", "클리닉", "진료소", "내과", "소아과", "이비인후과"]],
    ["병원", ["병원"]],
  ];
  const found: Facility["type"][] = [];
  let remaining = text;
  for (const [type, keys] of pairs) {
    const ordered = [...keys].sort((a, b) => b.length - a.length);
    for (const key of ordered) {
      if (!remaining.includes(key)) continue;
      if (!found.includes(type)) found.push(type);
      remaining = remaining.split(key).join(" ");
      break;
    }
  }
  return found;
}

/**
 * Extract structured signals from free-form Korean GIS queries.
 * Keep pure and side-effect free so new data domains only add cue lists.
 */
export function extractQuerySignals(query: string): QuerySignals {
  const raw = query.trim();
  const normalized = raw.replace(/\s+/g, " ");
  const text = normalized;
  const districts = extractDistricts(text);
  const dongs = matchPlacesInText(text);
  const radiusKm = extractRadiusKm(text.toLowerCase());
  const facilityTypes = extractFacilityTypes(text);

  // If dong matched but district missing, infer district for scoping UI
  for (const dong of dongs) {
    if (dong.district && !districts.includes(dong.district)) {
      districts.push(dong.district);
    }
  }

  const spatial = new Set<SpatialCue>();
  const metrics = new Set<MetricCue>();

  if (
    includesAny(text, [
      "근처",
      "주변",
      "인근",
      "가까운 곳",
      "가까운데",
      "가까운",
      "옆",
      "근방",
      "부근",
      "가까이",
    ])
  ) {
    spatial.add("nearby");
    metrics.add("kakaoLive");
  }
  // Bare "안에"/"이내"-style radius wording is ambiguous without a facility mention
  // (e.g. "거창군 안에서" is just a place reference, not a radius query). Mirror the
  // same medical/facility co-occurrence guard extractRadiusKm() uses for colloquial units.
  const hasMedicalOrFacilityWord = includesAny(text, ["병원", "의료", "의원", "시설", "약국"]);
  if (
    radiusKm !== null ||
    (includesAny(text, ["반경", "접근성", "km", "키로", "이내", "안에"]) && hasMedicalOrFacilityWord)
  ) {
    spatial.add("radius");
  }
  if (
    includesAny(text, [
      "거리",
      "최근접",
      "얼마나 멀",
      "원거리",
      "먼 곳",
      "먼 동",
      "가까운 병원",
      "먼 병원",
      "멀리",
      "접근이 어려운",
    ])
  ) {
    spatial.add("distance");
  }
  if (
    includesAny(text, [
      "비교",
      "vs",
      "VS",
      "대비",
      "와 비교",
      "랑 비교",
      "차이",
      "어느 쪽이",
      "어디가 더",
    ])
  ) {
    spatial.add("compare");
  }
  if (
    includesAny(text, [
      "지도",
      "표시",
      "보여",
      "위치",
      "어디",
      "목록",
      "리스트",
      "찾아",
      "검색",
      "어디에",
    ])
  ) {
    spatial.add("map");
  }
  if (
    includesAny(text, [
      "순위",
      "많은",
      "적은",
      "높은",
      "낮은",
      "상위",
      "하위",
      "랭킹",
      "TOP",
      "top",
      "가장",
      "제일",
      "최고",
      "최다",
      "최소",
      "어느 동",
      "어디가",
      "어느 지역",
    ])
  ) {
    spatial.add("rank");
  }
  if (
    includesAny(text, [
      "상세",
      "자세히",
      "알려줘",
      "알려 줘",
      "현황",
      "지표",
      "정보",
      "어때",
      "어떤가",
      "상황",
      "개요",
    ])
  ) {
    spatial.add("detail");
  }

  if (
    includesAny(text, [
      "취약",
      "부족",
      "공백",
      "사각",
      "없",
      "모자란",
      "의료취약",
      "의료 공백",
      "병원이 없",
      "의원 없",
    ])
  ) {
    metrics.add("scarcity");
  }
  if (
    includesAny(text, [
      "고령",
      "노인",
      "노령",
      "어르신",
      "65세",
      "초고령",
      "고령화",
      "실버",
      "노년",
    ])
  ) {
    metrics.add("elderly");
  }
  if (
    includesAny(text, [
      "인구증가",
      "인구 증가",
      "늘어",
      "증가하",
      "성장",
      "유입",
      "늘고",
      "증가세",
      "인구가 늘",
      "몰리",
    ])
  ) {
    metrics.add("growth");
  }
  if (
    includesAny(text, [
      "인구감소",
      "인구 감소",
      "줄어",
      "감소하",
      "유출",
      "소멸",
      "축소",
      "줄고",
      "감소세",
      "인구가 줄",
    ])
  ) {
    metrics.add("decline");
  }
  if (includesAny(text, ["1인가구", "1인 가구", "단독가구", "혼자", "단독세대", "일인 가구"])) {
    metrics.add("singleHousehold");
  }
  if (
    includesAny(text, ["사망자", "사망 수", "사망수", "사망", "죽은", "죽는", "죽음", "죽어", "사망률", "돌아가신"])
  ) {
    metrics.add("death");
  }
  if (includesAny(text, ["출생자", "출생 수", "출생수", "출생", "태어", "출산", "신생아", "출생아"])) {
    metrics.add("birth");
  }
  // "자연증가"(natural increase) and "자연감소"(natural decrease) are opposite polarities —
  // keep them as distinct signals so ranking direction isn't conflated (see rankNaturalIncrease
  // vs rankNaturalDecrease in tool-registry.ts).
  if (
    includesAny(text, [
      "자연감소",
      "자연 감소",
      "사망 초과",
      "출생보다 사망",
      "사망이 출생보다",
      "사망>출생",
      "데스크로스",
    ])
  ) {
    metrics.add("naturalDecrease");
    metrics.add("death");
    if (includesAny(text, ["출생", "증가"])) metrics.add("birth");
  }
  if (includesAny(text, ["자연증가", "자연 증가", "인구 자연증가", "출생이 사망보다"])) {
    metrics.add("naturalIncrease");
    metrics.add("birth");
  }
  if (includesAny(text, ["밀도", "인구밀도", "빽빽", "밀집", "과밀"])) metrics.add("density");
  if (includesAny(text, ["인구", "주민", "거주", "사람", "인원", "사람 수", "인구수", "총인구", "몇 명"])) {
    metrics.add("population");
  }
  if (includesAny(text, ["세대", "가구 수", "가구수", "세대수", "세대 수"])) metrics.add("households");
  if (includesAny(text, ["유소년", "어린이", "아동", "청소년", "아이", "소아"])) metrics.add("youth");
  if (
    includesAny(text, [
      "의료",
      "병원",
      "의원",
      "보건",
      "클리닉",
      "진료",
      "시설",
      "의료기관",
      "병의원",
    ])
  ) {
    metrics.add("medical");
  }
  if (includesAny(text, ["야간", "밤", "심야", "저녁 진료", "24시", "밤늦게"])) metrics.add("night");
  if (includesAny(text, ["주말", "토요일", "일요일", "휴일", "토요 진료"])) metrics.add("weekend");
  if (facilityTypes.includes("약국") || includesAny(text, ["약국", "약방"])) metrics.add("pharmacy");
  if (
    facilityTypes.length > 0 ||
    includesAny(text, ["위치", "목록", "어디에", "찾아", "리스트", "보여줘", "보여 줘"])
  ) {
    metrics.add("facilityList");
  }
  if (includesAny(text, ["실시간", "카카오", "로컬 검색", "장소 검색", "지금 근처"])) {
    metrics.add("kakaoLive");
  }

  const includePharmacy = metrics.has("pharmacy");
  const polarityHigh = includesAny(text, [
    "많은",
    "높은",
    "큰",
    "심한",
    "상위",
    "많",
    "높",
    "최다",
    "최고",
    "잘",
  ]);
  const polarityLow = includesAny(text, [
    "적은",
    "낮은",
    "작은",
    "하위",
    "없",
    "부족",
    "적",
    "최소",
    "취약",
    "열악",
  ]);
  const wantsBest = includesAny(text, ["가장", "제일", "최고", "1위", "일등"]);
  const wantsWorst = includesAny(text, ["가장 취약", "제일 부족", "최악", "가장 적", "가장 낮"]);

  // "가까운/최근접" → closest-first; "먼" → farthest-first (default, matches prior behavior).
  const wantsNearest = includesAny(text, ["가까운", "최근접", "가장 가까운", "제일 가까운"]);
  const wantsFarthest = includesAny(text, [
    "먼 곳",
    "먼 동",
    "먼 병원",
    "멀리",
    "원거리",
    "접근이 어려운",
    "가장 먼",
    "제일 먼",
  ]);
  const nearestDirection: "near" | "far" = wantsNearest && !wantsFarthest ? "near" : "far";

  let freePlaceQuery: string | null = null;
  if (metrics.has("kakaoLive") || spatial.has("nearby")) {
    freePlaceQuery =
      facilityTypes[0] ??
      (metrics.has("pharmacy") ? "약국" : metrics.has("medical") ? "병원" : null);
    if (!freePlaceQuery) {
      const cleaned = text
        .replace(
          /근처|주변|인근|찾아|위치|보여|줘|주세요|행정동|실시간|카카오|어디|부근/g,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim();
      freePlaceQuery = cleaned.slice(0, 40) || "병원";
    }
  }

  // Dong mention alone is a strong detail cue
  if (dongs.length > 0 && metrics.size === 0 && !spatial.has("compare")) {
    spatial.add("detail");
  }

  const wantsDistrictLevel = SGG_CUES.some((cue) => normalized.includes(cue));

  return {
    raw,
    normalized,
    districts,
    dongs,
    radiusKm,
    facilityTypes,
    spatial,
    metrics,
    includePharmacy,
    polarityHigh,
    polarityLow,
    freePlaceQuery,
    wantsDistrictLevel,
    wantsBest,
    wantsWorst,
    nearestDirection,
  };
}
