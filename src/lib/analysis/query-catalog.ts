import type { AnalysisIntent } from "./intent-schema";
import type { MetricCue, QuerySignals, SpatialCue } from "./query-signals";

export type ToolCatalogEntry = {
  id: AnalysisIntent["tool"];
  /** Short Korean label for suggestions */
  label: string;
  /** Example questions users can ask */
  examples: string[];
  /** How to build filters from signals */
  build: (signals: QuerySignals) => AnalysisIntent["filters"];
  /** Score contribution when cues fire */
  metricCues: MetricCue[];
  spatialCues: SpatialCue[];
  /** Base score when any metric cue matches */
  baseScore: number;
  /** Bonus per matching cue */
  cueBonus: number;
  /** Extra scorer for complex conditions */
  scoreExtra?: (signals: QuerySignals) => number;
  notice: (signals: QuerySignals) => string;
  /** Domain tags for future GIS layers (extensibility) */
  domains: Array<"population" | "vital" | "medical" | "access" | "region" | "kakao" | "future-gis">;
};

function medicalTypes(signals: QuerySignals): AnalysisIntent["filters"]["facilityTypes"] {
  const allMedical = ["종합병원", "병원", "요양병원", "의원", "치과의원", "한의원", "보건소"] as const;
  if (signals.includePharmacy && signals.facilityTypes.every((type) => type === "약국")) {
    return ["약국"];
  }
  // Bare "병원" means all medical institutions except pharmacy (product rule).
  if (signals.facilityTypes.length === 1 && signals.facilityTypes[0] === "병원") {
    return [...allMedical];
  }
  if (signals.facilityTypes.length > 0) {
    return signals.facilityTypes.filter((type) => type !== "약국" || signals.includePharmacy);
  }
  if (signals.includePharmacy) return ["약국"];
  return [...allMedical];
}

/**
 * Declarative tool catalog. Add a row here when a new GIS analysis tool ships.
 * Parser scoring and AI prompt generation both read from this list.
 */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "rankHospitalScarcity",
    label: "의료 취약",
    examples: ["의료 취약 지역", "병원이 부족한 동", "의료 공백"],
    domains: ["medical", "access"],
    metricCues: ["scarcity", "medical"],
    spatialCues: ["rank"],
    baseScore: 40,
    cueBonus: 18,
    scoreExtra: (s) =>
      (s.metrics.has("scarcity") ? 25 : 0) + (s.metrics.has("elderly") ? -20 : 0),
    build: () => ({}),
    notice: () => "의료 취약지수가 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankElderlyUnderserved",
    label: "고령 × 의료",
    examples: ["고령 인구 대비 병원 부족", "노인 의료 취약"],
    domains: ["population", "medical"],
    metricCues: ["elderly"],
    spatialCues: ["rank"],
    baseScore: 42,
    cueBonus: 22,
    scoreExtra: (s) => {
      let score = 10;
      if (s.metrics.has("elderly") && (s.metrics.has("medical") || s.metrics.has("scarcity"))) score += 45;
      else if (s.metrics.has("medical") || s.metrics.has("scarcity")) score += 15;
      return score;
    },
    build: () => ({}),
    notice: () => "고령 수요 대비 의료 공급이 약한 행정동 순입니다.",
  },
  {
    id: "rankPopulationGrowthPressure",
    label: "인구 증가",
    examples: ["인구가 늘어나는 지역", "인구 증가 압력"],
    domains: ["population"],
    metricCues: ["growth", "population"],
    spatialCues: ["rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) => (s.metrics.has("growth") ? 30 : s.metrics.has("population") && s.polarityHigh ? 8 : 0),
    build: () => ({}),
    notice: () => "12개월 인구 증감률이 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankPopulationDeclineRisk",
    label: "인구 감소",
    examples: ["인구가 줄어드는 동", "인구 감소 위험"],
    domains: ["population"],
    metricCues: ["decline", "population"],
    spatialCues: ["rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) => (s.metrics.has("decline") ? 30 : 0),
    build: () => ({}),
    notice: () => "12개월 인구 감소율이 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankSingleHouseholdRisk",
    label: "1인가구",
    examples: ["1인가구 비중 높은 동", "단독가구 많은 곳"],
    domains: ["population"],
    metricCues: ["singleHousehold"],
    spatialCues: ["rank"],
    baseScore: 45,
    cueBonus: 25,
    build: () => ({}),
    notice: () => "1인가구 비율이 높은 행정동 순입니다. 결측은 추정하지 않습니다.",
  },
  {
    id: "rankDeathCount",
    label: "사망 수",
    examples: ["사망자 많은 곳", "사망 수가 높은 동"],
    domains: ["vital", "population"],
    metricCues: ["death"],
    spatialCues: ["rank"],
    baseScore: 50,
    cueBonus: 28,
    build: () => ({}),
    notice: () => "기준월 사망 수가 많은 행정동 순입니다. 전입·전출은 포함하지 않습니다.",
  },
  {
    id: "rankBirthCount",
    label: "출생 수",
    examples: ["출생이 많은 지역", "출생아 많은 동"],
    domains: ["vital", "population"],
    metricCues: ["birth"],
    spatialCues: ["rank"],
    baseScore: 50,
    cueBonus: 28,
    build: () => ({}),
    notice: () => "기준월 출생 수가 많은 행정동 순입니다.",
  },
  {
    id: "rankNaturalDecrease",
    label: "자연감소",
    examples: ["자연감소가 큰 곳", "사망이 출생보다 많은 동"],
    domains: ["vital", "population"],
    metricCues: ["naturalDecrease", "death", "birth"],
    spatialCues: ["rank"],
    baseScore: 40,
    cueBonus: 18,
    scoreExtra: (s) => (s.metrics.has("naturalDecrease") ? 35 : s.metrics.has("death") && s.metrics.has("birth") ? 15 : 0),
    build: () => ({}),
    notice: () => "자연감소(사망−출생)가 큰 행정동 순입니다.",
  },
  {
    id: "rankPopulationDensity",
    label: "인구밀도",
    examples: ["인구밀도 높은 동", "밀집 지역"],
    domains: ["population", "future-gis"],
    metricCues: ["density", "population"],
    spatialCues: ["rank"],
    baseScore: 40,
    cueBonus: 22,
    scoreExtra: (s) => (s.metrics.has("density") ? 35 : 0),
    build: () => ({}),
    notice: () => "인구밀도(명/km²)가 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankPopulationSize",
    label: "총인구",
    examples: ["인구가 많은 동", "주민 수 많은 지역"],
    domains: ["population"],
    metricCues: ["population"],
    spatialCues: ["rank"],
    baseScore: 28,
    cueBonus: 16,
    scoreExtra: (s) =>
      s.metrics.has("population") && s.polarityHigh && !s.metrics.has("growth") && !s.metrics.has("density")
        ? 25
        : 0,
    build: () => ({}),
    notice: () => "기준월 총인구가 많은 행정동 순입니다.",
  },
  {
    id: "rankElderlyRatio",
    label: "고령화율",
    examples: ["고령화율 높은 동", "노인 비율 높은 곳"],
    domains: ["population"],
    metricCues: ["elderly"],
    spatialCues: ["rank"],
    baseScore: 30,
    cueBonus: 18,
    scoreExtra: (s) =>
      s.metrics.has("elderly") &&
      !s.metrics.has("medical") &&
      !s.metrics.has("scarcity") &&
      (s.normalized.includes("비율") || s.normalized.includes("화율") || s.normalized.includes("고령화"))
        ? 32
        : s.metrics.has("elderly") && !s.metrics.has("medical")
          ? 8
          : 0,
    build: () => ({}),
    notice: () => "고령인구 비율이 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "countFacilitiesWithinRadius",
    label: "반경 접근성",
    examples: ["2km 안 병원 적은 곳", "반경 접근성"],
    domains: ["access", "medical"],
    metricCues: ["medical", "facilityList"],
    spatialCues: ["radius", "rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) => (s.radiusKm !== null || s.spatial.has("radius") ? 40 : 0),
    build: (s) => ({ radiusKm: s.radiusKm ?? 2 }),
    notice: (s) => `대표점 기준 ${s.radiusKm ?? 2}km 반경 의료기관 수를 비교했습니다.`,
  },
  {
    id: "nearestFacilityDistance",
    label: "최근접 거리",
    examples: ["병원까지 먼 동", "최근접 의료기관 거리"],
    domains: ["access", "medical"],
    metricCues: ["medical"],
    spatialCues: ["distance", "rank"],
    baseScore: 38,
    cueBonus: 22,
    scoreExtra: (s) => (s.spatial.has("distance") ? 40 : 0),
    build: () => ({}),
    notice: () => "행정동 대표점 기준 최근접 의료기관 직선거리를 계산했습니다.",
  },
  {
    id: "filterFacilitiesByTypeAndHours",
    label: "시설 목록",
    examples: ["종합병원 위치", "약국만 보여줘", "야간 진료 병원"],
    domains: ["medical", "kakao"],
    metricCues: ["facilityList", "pharmacy", "night", "weekend", "medical"],
    spatialCues: ["map", "nearby"],
    baseScore: 32,
    cueBonus: 14,
    scoreExtra: (s) => {
      let score = 0;
      if (s.facilityTypes.length > 0) score += 30;
      if (s.metrics.has("night") || s.metrics.has("weekend")) score += 35;
      if (s.metrics.has("pharmacy")) score += 25;
      if (s.spatial.has("map") && s.metrics.has("medical")) score += 15;
      return score;
    },
    build: (s) => ({
      facilityTypes: medicalTypes(s),
      requireNightHours: s.metrics.has("night") ? true : undefined,
      requireWeekendHours: s.metrics.has("weekend") ? true : undefined,
      includePharmacy: s.includePharmacy || undefined,
    }),
    notice: (s) => {
      if (s.metrics.has("night")) return "야간 운영 정보가 있는 시설만 표시합니다. 값이 없으면 제외합니다.";
      if (s.metrics.has("weekend")) return "주말 운영 정보가 있는 시설만 표시합니다.";
      if (s.includePharmacy && s.facilityTypes.every((t) => t === "약국")) return "약국 위치를 지도에 표시했습니다.";
      return "조건에 맞는 의료기관을 지도에 표시했습니다.";
    },
  },
  {
    id: "compareRegions",
    label: "지역 비교",
    examples: ["기장군과 강서구 비교", "해운대 vs 수영"],
    domains: ["region", "population"],
    metricCues: [],
    spatialCues: ["compare"],
    baseScore: 20,
    cueBonus: 25,
    scoreExtra: (s) => {
      if (s.spatial.has("compare") && s.districts.length >= 2) return 50;
      if (s.districts.length >= 2) return 35;
      if (s.spatial.has("compare")) return 25;
      return 0;
    },
    build: (s) => ({
      compare:
        s.districts.length >= 2
          ? s.districts.slice(0, 2)
          : s.districts.length === 1
            ? [s.districts[0], s.districts[0] === "기장군" ? "강서구" : "기장군"]
            : ["기장군", "강서구"],
    }),
    notice: (s) => {
      const pair =
        s.districts.length >= 2 ? s.districts.slice(0, 2) : ["기장군", "강서구"];
      return `${pair.join(" · ")} 관련 행정동 지표를 비교합니다.`;
    },
  },
  {
    id: "getRegionDetails",
    label: "지역 상세",
    examples: ["해운대구 상세", "중구 현황"],
    domains: ["region", "population"],
    metricCues: [],
    spatialCues: ["detail"],
    baseScore: 18,
    cueBonus: 20,
    scoreExtra: (s) => {
      if (s.districts.length === 1 && (s.spatial.has("detail") || s.metrics.size === 0)) return 40;
      if (s.districts.length === 1) return 22;
      return 0;
    },
    build: (s) => ({ regions: s.districts.slice(0, 1) }),
    notice: (s) =>
      s.districts[0]
        ? `${s.districts[0]} 관련 행정동 상세 지표를 불러왔습니다.`
        : "지역 상세 지표를 표시합니다.",
  },
];

export function scoreCatalogEntry(entry: ToolCatalogEntry, signals: QuerySignals): number {
  let score = 0;
  let metricHits = 0;
  for (const cue of entry.metricCues) {
    if (signals.metrics.has(cue)) {
      metricHits += 1;
      score += entry.cueBonus;
    }
  }
  for (const cue of entry.spatialCues) {
    if (signals.spatial.has(cue)) score += Math.round(entry.cueBonus * 0.65);
  }
  if (metricHits > 0 || entry.spatialCues.some((cue) => signals.spatial.has(cue))) {
    score += entry.baseScore;
  }
  if (entry.scoreExtra) score += entry.scoreExtra(signals);
  return score;
}

export function buildAiToolGuide(): string {
  return TOOL_CATALOG.map((entry) => {
    const examples = entry.examples.map((example) => `"${example}"`).join(", ");
    return `- ${entry.id}: ${entry.label} / 예: ${examples} / domains=${entry.domains.join("|")}`;
  }).join("\n");
}
