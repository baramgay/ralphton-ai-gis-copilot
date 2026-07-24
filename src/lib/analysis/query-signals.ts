import type { Facility } from "@/lib/domain/schemas";
import { matchPlacesInText, type MatchedPlace } from "@/lib/geo/place-index";

import { DISTRICT_ALIASES, DISTRICT_LABELS } from "./query-catalog-meta";

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
  wantsBest: boolean;
  wantsWorst: boolean;
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
  if (radiusKm !== null || includesAny(text, ["반경", "접근성", "km", "키로", "이내", "안에"])) {
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
  if (includesAny(text, ["사망자", "사망 수", "사망수", "사망", "죽은", "사망률", "돌아가신"])) {
    metrics.add("death");
  }
  if (includesAny(text, ["출생자", "출생 수", "출생수", "출생", "태어", "출산", "신생아", "출생아"])) {
    metrics.add("birth");
  }
  if (
    includesAny(text, [
      "자연감소",
      "자연 감소",
      "사망 초과",
      "출생보다 사망",
      "자연증가",
      "자연 증가",
      "데스크로스",
    ])
  ) {
    metrics.add("naturalDecrease");
    if (includesAny(text, ["감소", "초과", "사망"])) metrics.add("death");
    if (includesAny(text, ["출생", "증가"])) metrics.add("birth");
  }
  if (includesAny(text, ["밀도", "인구밀도", "빽빽", "밀집", "과밀"])) metrics.add("density");
  if (includesAny(text, ["인구", "주민", "거주", "사람 수", "인구수", "총인구", "몇 명"])) {
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

  let freePlaceQuery: string | null = null;
  if (metrics.has("kakaoLive") || spatial.has("nearby")) {
    freePlaceQuery =
      facilityTypes[0] ??
      (metrics.has("pharmacy") ? "약국" : metrics.has("medical") ? "병원" : null);
    if (!freePlaceQuery) {
      const cleaned = text
        .replace(
          /근처|주변|인근|찾아|위치|보여|줘|주세요|부산|행정동|실시간|카카오|어디|부근/g,
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
    wantsBest,
    wantsWorst,
  };
}
