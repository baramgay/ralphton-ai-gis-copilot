import type { AnalysisIntent } from "./intent-schema";
import type { MetricCue, QuerySignals, SpatialCue } from "./query-signals";

export type ToolCatalogEntry = {
  id: AnalysisIntent["tool"];
  label: string;
  examples: string[];
  build: (signals: QuerySignals) => AnalysisIntent["filters"];
  metricCues: MetricCue[];
  spatialCues: SpatialCue[];
  baseScore: number;
  cueBonus: number;
  scoreExtra?: (signals: QuerySignals) => number;
  notice: (signals: QuerySignals) => string;
  domains: Array<"population" | "vital" | "medical" | "access" | "region" | "kakao" | "future-gis">;
};

function medicalTypes(signals: QuerySignals): AnalysisIntent["filters"]["facilityTypes"] {
  const allMedical = ["종합병원", "병원", "요양병원", "의원", "치과의원", "한의원", "보건소"] as const;
  if (signals.includePharmacy && signals.facilityTypes.every((type) => type === "약국")) {
    return ["약국"];
  }
  if (signals.facilityTypes.length === 1 && signals.facilityTypes[0] === "병원") {
    return [...allMedical];
  }
  if (signals.facilityTypes.length > 0) {
    return signals.facilityTypes.filter((type) => type !== "약국" || signals.includePharmacy);
  }
  if (signals.includePharmacy) return ["약국"];
  return [...allMedical];
}

/** Attach dong/district scope when user named places. Prefer adm_cd2 for dongs. */
function scopeFilters(
  base: AnalysisIntent["filters"],
  signals: QuerySignals,
  mode: "rank" | "list" | "detail" | "compare" = "rank",
): AnalysisIntent["filters"] {
  if (mode === "compare") return base;
  if (base.regions?.length || base.compare?.length) return base;

  // Exact dong codes first (strongest)
  if (signals.dongs.length > 0) {
    return {
      ...base,
      regions: signals.dongs.slice(0, 8).map((dong) => dong.adm_cd2),
    };
  }

  if (signals.districts.length === 1) {
    return { ...base, regions: [signals.districts[0]] };
  }
  if (signals.districts.length >= 2 && mode === "rank") {
    return { ...base, regions: signals.districts.slice(0, 5) };
  }
  return base;
}

/**
 * Declarative tool catalog. Add a row here when a new GIS analysis tool ships.
 */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "rankHospitalScarcity",
    label: "의료 취약",
    examples: ["의료 취약 지역", "병원이 부족한 동", "어디가 제일 의료 취약해"],
    domains: ["medical", "access"],
    metricCues: ["scarcity", "medical"],
    spatialCues: ["rank"],
    baseScore: 40,
    cueBonus: 18,
    scoreExtra: (s) =>
      (s.metrics.has("scarcity") ? 28 : 0) +
      (s.metrics.has("elderly") ? -22 : 0) +
      (s.wantsWorst || (s.polarityLow && s.metrics.has("medical")) ? 12 : 0),
    build: (s) => scopeFilters({}, s),
    notice: (s) =>
      s.districts[0]
        ? `${s.districts.join("·")} 범위에서 의료 취약지수가 높은 순입니다.`
        : "의료 취약지수가 높은 행정동 순으로 정렬했습니다.",
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
      if (s.metrics.has("elderly") && (s.metrics.has("medical") || s.metrics.has("scarcity"))) {
        score += 48;
      } else if (s.metrics.has("medical") || s.metrics.has("scarcity")) {
        score += 12;
      }
      return score;
    },
    build: (s) => scopeFilters({}, s),
    notice: () => "고령 수요 대비 의료 공급이 약한 행정동 순입니다.",
  },
  {
    id: "rankPopulationGrowthPressure",
    label: "인구 증가",
    examples: ["인구가 늘어나는 지역", "인구 증가 압력", "어디 인구가 늘고 있어"],
    domains: ["population"],
    metricCues: ["growth", "population"],
    spatialCues: ["rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) =>
      s.metrics.has("growth")
        ? 32
        : s.metrics.has("population") && s.polarityHigh && s.normalized.includes("늘")
          ? 12
          : 0,
    build: (s) => scopeFilters({}, s),
    notice: () => "12개월 인구 증감률이 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankPopulationDeclineRisk",
    label: "인구 감소",
    examples: ["인구가 줄어드는 동", "인구 감소 위험", "인구 유출"],
    domains: ["population"],
    metricCues: ["decline", "population"],
    spatialCues: ["rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) => (s.metrics.has("decline") ? 32 : 0),
    build: (s) => scopeFilters({}, s),
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
    scoreExtra: (s) => (s.metrics.has("singleHousehold") ? 15 : 0),
    build: (s) => scopeFilters({}, s),
    notice: () => "1인가구 비율이 높은 행정동 순입니다. 결측은 추정하지 않습니다.",
  },
  {
    id: "rankDeathCount",
    label: "사망 수",
    examples: ["사망자 많은 곳", "사망 수가 높은 동", "어디 사망이 많아"],
    domains: ["vital", "population"],
    metricCues: ["death"],
    spatialCues: ["rank"],
    baseScore: 50,
    cueBonus: 28,
    scoreExtra: (s) => (s.metrics.has("death") && !s.metrics.has("naturalDecrease") ? 12 : 0),
    build: (s) => scopeFilters({}, s),
    notice: () => "기준월 사망 수가 많은 행정동 순입니다. 전입·전출은 포함하지 않습니다.",
  },
  {
    id: "rankBirthCount",
    label: "출생 수",
    examples: ["출생이 많은 지역", "출생아 많은 동", "출산 많은 곳"],
    domains: ["vital", "population"],
    metricCues: ["birth"],
    spatialCues: ["rank"],
    baseScore: 50,
    cueBonus: 28,
    scoreExtra: (s) => (s.metrics.has("birth") && !s.metrics.has("naturalDecrease") ? 12 : 0),
    build: (s) => scopeFilters({}, s),
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
    scoreExtra: (s) =>
      s.metrics.has("naturalDecrease")
        ? 38
        : s.metrics.has("death") && s.metrics.has("birth")
          ? 18
          : 0,
    build: (s) => scopeFilters({}, s),
    notice: () => "자연감소(사망−출생)가 큰 행정동 순입니다.",
  },
  {
    id: "rankPopulationDensity",
    label: "인구밀도",
    examples: ["인구밀도 높은 동", "밀집 지역", "빽빽한 동네"],
    domains: ["population", "future-gis"],
    metricCues: ["density", "population"],
    spatialCues: ["rank"],
    baseScore: 40,
    cueBonus: 22,
    scoreExtra: (s) => (s.metrics.has("density") ? 38 : 0),
    build: (s) => scopeFilters({}, s),
    notice: () => "인구밀도(명/km²)가 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "rankPopulationSize",
    label: "총인구",
    examples: ["인구가 많은 동", "주민 수 많은 지역", "사람 많은 곳"],
    domains: ["population"],
    metricCues: ["population"],
    spatialCues: ["rank"],
    baseScore: 28,
    cueBonus: 16,
    scoreExtra: (s) => {
      if (!s.metrics.has("population")) return 0;
      if (s.metrics.has("growth") || s.metrics.has("decline") || s.metrics.has("density")) return 0;
      if (s.polarityHigh || s.wantsBest) return 30;
      if (s.spatial.has("rank")) return 14;
      return 6;
    },
    build: (s) => scopeFilters({}, s),
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
    scoreExtra: (s) => {
      if (!s.metrics.has("elderly")) return 0;
      if (s.metrics.has("medical") || s.metrics.has("scarcity")) return -5;
      if (
        s.normalized.includes("비율") ||
        s.normalized.includes("화율") ||
        s.normalized.includes("고령화") ||
        s.normalized.includes("비중")
      ) {
        return 36;
      }
      return 10;
    },
    build: (s) => scopeFilters({}, s),
    notice: () => "고령인구 비율이 높은 행정동 순으로 정렬했습니다.",
  },
  {
    id: "countFacilitiesWithinRadius",
    label: "반경 접근성",
    examples: ["2km 안 병원 적은 곳", "반경 접근성", "3키로 안에 병원"],
    domains: ["access", "medical"],
    metricCues: ["medical", "facilityList"],
    spatialCues: ["radius", "rank"],
    baseScore: 35,
    cueBonus: 20,
    scoreExtra: (s) => {
      let score = 0;
      if (s.radiusKm !== null || s.spatial.has("radius")) score += 42;
      if (s.polarityLow && s.metrics.has("medical")) score += 18;
      if (s.polarityHigh && s.metrics.has("medical") && s.spatial.has("radius")) score += 10;
      return score;
    },
    build: (s) => scopeFilters({ radiusKm: s.radiusKm ?? 2 }, s),
    notice: (s) => `대표점 기준 ${s.radiusKm ?? 2}km 반경 의료기관 수를 비교했습니다.`,
  },
  {
    id: "nearestFacilityDistance",
    label: "최근접 거리",
    examples: ["병원까지 먼 동", "최근접 의료기관 거리", "의료기관이 멀리 있는 곳"],
    domains: ["access", "medical"],
    metricCues: ["medical"],
    spatialCues: ["distance", "rank"],
    baseScore: 38,
    cueBonus: 22,
    scoreExtra: (s) =>
      (s.spatial.has("distance") ? 42 : 0) + (s.polarityHigh && s.normalized.includes("먼") ? 12 : 0),
    build: (s) => scopeFilters({}, s),
    notice: () => "행정동 대표점 기준 최근접 의료기관 직선거리를 계산했습니다.",
  },
  {
    id: "filterFacilitiesByTypeAndHours",
    label: "시설 목록",
    examples: ["종합병원 위치", "약국만 보여줘", "야간 진료 병원", "치과 어디 있어"],
    domains: ["medical", "kakao"],
    metricCues: ["facilityList", "pharmacy", "night", "weekend", "medical"],
    spatialCues: ["map", "nearby"],
    baseScore: 32,
    cueBonus: 14,
    scoreExtra: (s) => {
      let score = 0;
      if (s.facilityTypes.length > 0) score += 32;
      if (s.metrics.has("night") || s.metrics.has("weekend")) score += 38;
      if (s.metrics.has("pharmacy")) score += 28;
      if (s.spatial.has("map") && s.metrics.has("medical")) score += 16;
      if (s.spatial.has("nearby")) score += 20;
      // Prefer list over scarcity when user only asks to show facilities
      if (
        s.metrics.has("facilityList") &&
        !s.metrics.has("scarcity") &&
        !s.spatial.has("rank") &&
        !s.spatial.has("radius")
      ) {
        score += 12;
      }
      return score;
    },
    build: (s) =>
      scopeFilters(
        {
          facilityTypes: medicalTypes(s),
          requireNightHours: s.metrics.has("night") ? true : undefined,
          requireWeekendHours: s.metrics.has("weekend") ? true : undefined,
          includePharmacy: s.includePharmacy || undefined,
        },
        s,
        "list",
      ),
    notice: (s) => {
      if (s.metrics.has("night")) return "야간 운영 정보가 있는 시설만 표시합니다. 값이 없으면 제외합니다.";
      if (s.metrics.has("weekend")) return "주말 운영 정보가 있는 시설만 표시합니다.";
      if (s.includePharmacy && s.facilityTypes.every((t) => t === "약국")) {
        return "약국 위치를 지도에 표시했습니다.";
      }
      if (s.districts[0]) return `${s.districts.join("·")} 조건에 맞는 의료기관을 표시했습니다.`;
      return "조건에 맞는 의료기관을 지도에 표시했습니다.";
    },
  },
  {
    id: "compareRegions",
    label: "지역 비교",
    examples: ["창원과 김해 비교", "진주 vs 사천", "어디가 더 취약해"],
    domains: ["region", "population"],
    metricCues: [],
    spatialCues: ["compare"],
    baseScore: 20,
    cueBonus: 25,
    scoreExtra: (s) => {
      if (s.spatial.has("compare") && s.districts.length >= 2) return 55;
      if (s.districts.length >= 2) return 40;
      if (s.spatial.has("compare")) return 28;
      return 0;
    },
    build: (s) => ({
      compare:
        s.districts.length >= 2
          ? s.districts.slice(0, 2)
          : s.districts.length === 1
            ? [s.districts[0], s.districts[0] === "창원시 의창구" ? "김해시" : "창원시 의창구"]
            : ["창원시 의창구", "김해시"],
    }),
    notice: (s) => {
      const pair =
        s.districts.length >= 2 ? s.districts.slice(0, 2) : ["창원시 의창구", "김해시"];
      return `${pair.join(" · ")} 구·군 단위 지표를 합산 비교합니다.`;
    },
  },
  {
    id: "getRegionDetails",
    label: "지역 상세",
    examples: ["김해시 상세", "진주시 현황", "양산시 어때"],
    domains: ["region", "population"],
    metricCues: [],
    spatialCues: ["detail"],
    baseScore: 18,
    cueBonus: 20,
    scoreExtra: (s) => {
      if (s.dongs.length >= 1 && s.metrics.size === 0) return 52;
      if (s.districts.length === 1 && s.spatial.has("detail") && s.metrics.size === 0) return 48;
      if (s.districts.length === 1 && s.metrics.size === 0) return 36;
      if (s.districts.length === 1 && s.spatial.has("detail")) return 28;
      if (s.districts.length === 1) return 16;
      return 0;
    },
    build: (s) => {
      if (s.dongs.length > 0) {
        return { regions: s.dongs.slice(0, 5).map((dong) => dong.adm_cd2) };
      }
      return { regions: s.districts.slice(0, 1) };
    },
    notice: (s) => {
      if (s.dongs[0]) {
        return `${s.dongs.map((d) => d.shortName).join("·")} 상세 지표를 불러왔습니다.`;
      }
      return s.districts[0]
        ? `${s.districts[0]} 관련 행정동 상세 지표를 불러왔습니다.`
        : "지역 상세 지표를 표시합니다.";
    },
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
  // Soft boost when user named a district and tool can scope
  if (signals.districts.length > 0 && (entry.id === "getRegionDetails" || entry.id.startsWith("rank"))) {
    score += 4;
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
