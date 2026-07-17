import type { Facility } from "@/lib/domain/schemas";

import { BUSAN_DISTRICT_LABELS } from "./query-catalog-meta";

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
  radiusKm: 1 | 2 | 3 | null;
  facilityTypes: Facility["type"][];
  spatial: Set<SpatialCue>;
  metrics: Set<MetricCue>;
  includePharmacy: boolean;
  polarityHigh: boolean;
  polarityLow: boolean;
  freePlaceQuery: string | null;
};

const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:km|키로|킬로미터|킬로)/gi;

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractDistricts(text: string): string[] {
  const labels = [...BUSAN_DISTRICT_LABELS].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let remaining = text;
  for (const label of labels) {
    if (!remaining.includes(label)) continue;
    found.push(label);
    remaining = remaining.split(label).join(" ");
  }
  return found.sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

function extractRadiusKm(text: string): 1 | 2 | 3 | null {
  for (const match of text.matchAll(RADIUS_PATTERN)) {
    const value = Number.parseFloat(match[1]);
    if (value === 1 || value === 2 || value === 3) return value;
  }
  if (includesAny(text, ["반경", "접근성", "인근", "주변"]) && includesAny(text, ["병원", "의료", "의원", "시설"])) {
    return 2;
  }
  return null;
}

function extractFacilityTypes(text: string): Facility["type"][] {
  // Longer labels first so "종합병원" is not also tagged as "병원".
  const pairs: Array<[Facility["type"], string[]]> = [
    ["종합병원", ["종합병원", "대학병원", "상급종합"]],
    ["요양병원", ["요양병원"]],
    ["치과의원", ["치과의원", "치과"]],
    ["한의원", ["한의원", "한방"]],
    ["보건소", ["보건소", "보건지소"]],
    ["약국", ["약국", "약방"]],
    ["의원", ["의원", "클리닉", "진료소"]],
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
  const radiusKm = extractRadiusKm(text.toLowerCase());
  const facilityTypes = extractFacilityTypes(text);

  const spatial = new Set<SpatialCue>();
  const metrics = new Set<MetricCue>();

  if (includesAny(text, ["근처", "주변", "인근", "가까운 곳", "가까운데", "옆", "근방"])) {
    spatial.add("nearby");
    metrics.add("kakaoLive");
  }
  if (radiusKm !== null || includesAny(text, ["반경", "접근성", "km", "키로"])) spatial.add("radius");
  if (includesAny(text, ["거리", "최근접", "얼마나 멀", "원거리", "먼 곳", "가까운 병원", "먼 병원"])) {
    spatial.add("distance");
  }
  if (includesAny(text, ["비교", "vs", "대비", "와 비교", "랑 비교", "차이"])) spatial.add("compare");
  if (includesAny(text, ["지도", "표시", "보여", "위치", "어디", "목록", "리스트"])) spatial.add("map");
  if (includesAny(text, ["순위", "많은", "적은", "높은", "낮은", "상위", "하위", "랭킹", "TOP", "top"])) {
    spatial.add("rank");
  }
  if (includesAny(text, ["상세", "자세히", "알려줘", "현황", "지표", "정보"])) spatial.add("detail");

  if (includesAny(text, ["취약", "부족", "공백", "사각", "없", "모자란", "의료취약"])) metrics.add("scarcity");
  if (includesAny(text, ["고령", "노인", "노령", "어르신", "65세", "초고령", "고령화"])) metrics.add("elderly");
  if (includesAny(text, ["인구증가", "인구 증가", "늘어", "증가하", "성장", "유입"])) metrics.add("growth");
  if (includesAny(text, ["인구감소", "인구 감소", "줄어", "감소하", "유출", "소멸", "축소"])) metrics.add("decline");
  if (includesAny(text, ["1인가구", "1인 가구", "단독가구", "혼자", "단독세대"])) metrics.add("singleHousehold");
  if (includesAny(text, ["사망자", "사망 수", "사망수", "사망", "죽은", "사망률"])) metrics.add("death");
  if (includesAny(text, ["출생자", "출생 수", "출생수", "출생", "태어", "출산"])) metrics.add("birth");
  if (includesAny(text, ["자연감소", "자연 감소", "사망 초과", "출생보다 사망", "자연증가"])) {
    if (includesAny(text, ["감소", "초과", "사망"])) metrics.add("naturalDecrease");
  }
  if (includesAny(text, ["밀도", "인구밀도", "빽빽", "밀집"])) metrics.add("density");
  if (includesAny(text, ["인구", "주민", "거주", "사람 수", "인구수"])) metrics.add("population");
  if (includesAny(text, ["세대", "가구 수", "가구수"])) metrics.add("households");
  if (includesAny(text, ["유소년", "어린이", "아동", "청소년"])) metrics.add("youth");
  if (includesAny(text, ["의료", "병원", "의원", "보건", "클리닉", "진료", "시설"])) metrics.add("medical");
  if (includesAny(text, ["야간", "밤", "심야", "저녁 진료"])) metrics.add("night");
  if (includesAny(text, ["주말", "토요일", "일요일", "휴일"])) metrics.add("weekend");
  if (facilityTypes.includes("약국") || includesAny(text, ["약국", "약방"])) metrics.add("pharmacy");
  if (facilityTypes.length > 0 || includesAny(text, ["위치", "목록", "어디에", "찾아"])) {
    metrics.add("facilityList");
  }
  if (includesAny(text, ["실시간", "카카오", "로컬 검색", "장소 검색"])) metrics.add("kakaoLive");

  const includePharmacy = metrics.has("pharmacy");
  const polarityHigh = includesAny(text, ["많은", "높은", "큰", "심한", "상위", "많", "높"]);
  const polarityLow = includesAny(text, ["적은", "낮은", "작은", "하위", "없", "부족", "적"]);

  let freePlaceQuery: string | null = null;
  if (metrics.has("kakaoLive") || spatial.has("nearby")) {
    freePlaceQuery = facilityTypes[0] ?? (metrics.has("pharmacy") ? "약국" : metrics.has("medical") ? "병원" : null);
    if (!freePlaceQuery) {
      const cleaned = text
        .replace(/근처|주변|인근|찾아|위치|보여|줘|주세요|부산|행정동/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      freePlaceQuery = cleaned.slice(0, 40) || "병원";
    }
  }

  return {
    raw,
    normalized,
    districts,
    radiusKm,
    facilityTypes,
    spatial,
    metrics,
    includePharmacy,
    polarityHigh,
    polarityLow,
    freePlaceQuery,
  };
}
