import {
  ALLOWED_FACILITY_TYPES,
  ALLOWED_TOOLS,
  AnalysisIntentSchema,
  type AnalysisIntent,
} from "@/lib/analysis/intent-schema";
import type { AnalysisResult, AnalyzedRegion, LegendItem, MetricDescriptor } from "@/lib/analysis/result";
import type { AnalysisSnapshot, Facility, RegionSeries } from "@/lib/domain/schemas";
import {
  countFacilitiesWithinRadius as calculateFacilitiesWithinRadius,
  medicalVulnerabilityIndex,
  nearestFacilityDistance as calculateNearestFacilityDistance,
  winsorizedMinMax,
} from "@/lib/gis/metrics";

type ToolName = (typeof ALLOWED_TOOLS)[number];
type AnalysisTool = (intent: AnalysisIntent, snapshot: AnalysisSnapshot) => AnalysisResult;
type SortDirection = "ascending" | "descending";

type AccessRecord = {
  region: RegionSeries;
  population: number | null;
  facilitiesPerTenThousand: number | null;
  elderlyRatio: number | null;
  nearestDistanceKm: number | null;
  facilitiesWithinTwoKm: number;
  vulnerabilityScore: number | null;
};

const MEDICAL_TYPES = ALLOWED_FACILITY_TYPES.filter((type) => type !== "약국");

const VULNERABILITY_LEGEND: LegendItem[] = [
  { label: "낮음", color: "#dbeafe", min: 0, max: 25 },
  { label: "보통", color: "#93c5fd", min: 25, max: 50 },
  { label: "높음", color: "#3b82f6", min: 50, max: 75 },
  { label: "매우 높음", color: "#1d4ed8", min: 75, max: 100 },
];

const SINGLE_COLOR_LEGEND: LegendItem[] = [
  { label: "분석값", color: "#2563eb", min: null, max: null },
];

function round(value: number | null, digits = 2): number | null {
  if (value === null) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function metric(
  label: string,
  value: number | null,
  unit: string,
  formula: string,
  referenceMonth: string,
  limitation: string,
): MetricDescriptor {
  return {
    label,
    value: round(value),
    unit,
    formula,
    referenceMonth,
    limitation,
  };
}

function result(overrides: Partial<AnalysisResult> & Pick<AnalysisResult, "title" | "summary">): AnalysisResult {
  return {
    title: overrides.title,
    summary: overrides.summary,
    rankedRegions: overrides.rankedRegions ?? [],
    selectedRegion: overrides.selectedRegion ?? null,
    filteredFacilities: overrides.filteredFacilities ?? [],
    legend: overrides.legend ?? [],
    formulaNotes: overrides.formulaNotes ?? [],
  };
}

function referenceIndex(region: RegionSeries, referenceMonth: string): number {
  return region.months.indexOf(referenceMonth);
}

function numericValueAt(values: readonly (number | null)[], index: number): number | null {
  if (index < 0) {
    return null;
  }

  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latestValue(
  region: RegionSeries,
  values: readonly (number | null)[],
  referenceMonth: string,
): number | null {
  return numericValueAt(values, referenceIndex(region, referenceMonth));
}

function regionMatches(region: RegionSeries, token: string): boolean {
  const normalized = token.trim();
  return region.adm_cd2 === normalized || region.adm_nm === normalized || region.adm_nm.includes(normalized);
}

function facilityMatchesRegion(facility: Facility, token: string): boolean {
  const normalized = token.trim();
  return facility.adm_cd2 === normalized || facility.adm_nm === normalized || facility.adm_nm.includes(normalized);
}

function regionTokens(intent: AnalysisIntent): string[] {
  return intent.filters.regions ?? intent.filters.compare ?? [];
}

function scopedRegions(intent: AnalysisIntent, snapshot: AnalysisSnapshot): RegionSeries[] {
  const tokens = regionTokens(intent);
  if (tokens.length === 0) {
    return [...snapshot.regions];
  }

  return snapshot.regions.filter((region) => tokens.some((token) => regionMatches(region, token)));
}

function resolvedFacilityTypes(intent: AnalysisIntent): Set<Facility["type"]> {
  const explicitTypes = intent.filters.facilityTypes;
  if (explicitTypes && explicitTypes.length > 0) {
    return new Set(explicitTypes);
  }

  return new Set(intent.filters.includePharmacy ? ALLOWED_FACILITY_TYPES : MEDICAL_TYPES);
}

function minutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function includesNightHours(hours: Facility["hours"]): boolean {
  if (!hours) {
    return false;
  }

  return Object.values(hours).some((range) => {
    if (!range) {
      return false;
    }

    const [startText, endText] = range.split("-");
    const start = minutes(startText);
    const end = minutes(endText);
    return start !== null && end !== null && (start < 360 || end >= 1200 || end < start);
  });
}

function includesWeekendHours(hours: Facility["hours"]): boolean {
  return Boolean(hours?.saturday || hours?.sunday);
}

function filteredFacilities(intent: AnalysisIntent, snapshot: AnalysisSnapshot, applyRegionScope: boolean): Facility[] {
  const facilityTypes = resolvedFacilityTypes(intent);
  const tokens = applyRegionScope ? regionTokens(intent) : [];

  return snapshot.facilities.filter((facility) => {
    if (!facilityTypes.has(facility.type)) {
      return false;
    }
    if (tokens.length > 0 && !tokens.some((token) => facilityMatchesRegion(facility, token))) {
      return false;
    }
    if (intent.filters.requireNightHours && !includesNightHours(facility.hours)) {
      return false;
    }
    if (intent.filters.requireWeekendHours && !includesWeekendHours(facility.hours)) {
      return false;
    }
    return true;
  });
}

function analysisRegion(region: RegionSeries, score: number | null, metrics: MetricDescriptor[]): AnalyzedRegion {
  return {
    adm_cd2: region.adm_cd2,
    adm_nm: region.adm_nm,
    representativePoint: region.representativePoint,
    areaSquareKm: region.areaSquareKm,
    rank: null,
    score: round(score),
    metrics,
  };
}

function ranked(
  regions: AnalyzedRegion[],
  direction: SortDirection,
  limit: number,
  preserveNull = false,
): AnalyzedRegion[] {
  const candidates = preserveNull ? [...regions] : regions.filter(({ score }) => score !== null);

  candidates.sort((left, right) => {
    if (left.score === null && right.score === null) {
      return left.adm_cd2.localeCompare(right.adm_cd2);
    }
    if (left.score === null) {
      return 1;
    }
    if (right.score === null) {
      return -1;
    }

    const scoreDifference = direction === "descending" ? right.score - left.score : left.score - right.score;
    return scoreDifference === 0 ? left.adm_cd2.localeCompare(right.adm_cd2) : scoreDifference;
  });

  return candidates.slice(0, limit).map((region, index) => ({ ...region, rank: index + 1 }));
}

function requestedLimit(intent: AnalysisIntent, total: number): number {
  return Math.min(intent.filters.limit ?? 10, total);
}

function percentage(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }

  return (numerator / denominator) * 100;
}

function populationChange(region: RegionSeries, referenceMonth: string): number | null {
  const currentIndex = referenceIndex(region, referenceMonth);
  const current = numericValueAt(region.population, currentIndex);
  const prior = numericValueAt(region.population, currentIndex - 12);

  if (current === null || prior === null || prior <= 0) {
    return null;
  }

  return ((current - prior) / prior) * 100;
}

function detailMetrics(region: RegionSeries, referenceMonth: string): MetricDescriptor[] {
  const index = referenceIndex(region, referenceMonth);
  const population = numericValueAt(region.population, index);
  const households = numericValueAt(region.households, index);
  const elderly = numericValueAt(region.elderlyPopulation, index);
  const onePerson = numericValueAt(region.onePersonHouseholds, index);
  const births = numericValueAt(region.births, index);
  const deaths = numericValueAt(region.deaths, index);
  const density = population === null || region.areaSquareKm <= 0 ? null : population / region.areaSquareKm;
  const naturalChange = births === null || deaths === null ? null : births - deaths;

  return [
    metric("총인구", population, "명", "해당 기준월 주민 수", referenceMonth, "데모 값은 합성 자료입니다."),
    metric("세대 수", households, "세대", "해당 기준월 세대 수", referenceMonth, "세대 구성은 별도로 반영하지 않습니다."),
    metric(
      "인구밀도",
      density,
      "명/km²",
      "총인구 ÷ 행정동 면적(km²)",
      referenceMonth,
      "경계 면적과 대표 기준월 인구를 사용합니다.",
    ),
    metric("고령인구 비율", percentage(elderly, population), "%", "65세 이상 인구 ÷ 총인구 × 100", referenceMonth, "연령 구간은 65세 이상입니다."),
    metric(
      "1인가구 비율",
      percentage(onePerson, households),
      "%",
      "1인가구 수 ÷ 전체 세대 수 × 100",
      referenceMonth,
      "원자료가 없으면 값을 추정하지 않고 데이터 없음으로 유지합니다.",
    ),
    metric(
      "자연증가",
      naturalChange,
      "명",
      "출생 수 - 사망 수",
      referenceMonth,
      "전입과 전출은 포함하지 않습니다.",
    ),
  ];
}

function accessRecords(intent: AnalysisIntent, snapshot: AnalysisSnapshot): { records: AccessRecord[]; facilities: Facility[] } {
  const regions = scopedRegions(intent, snapshot);
  const facilities = filteredFacilities(intent, snapshot, false);
  const raw = regions.map((region) => {
    const population = latestValue(region, region.population, snapshot.referenceMonth);
    const elderlyPopulation = latestValue(region, region.elderlyPopulation, snapshot.referenceMonth);
    const localFacilityCount = facilities.filter((facility) => facility.adm_cd2 === region.adm_cd2).length;
    const facilitiesPerTenThousand =
      population === null || population <= 0 ? null : (localFacilityCount / population) * 10_000;
    const elderlyRatio = percentage(elderlyPopulation, population);
    const nearestDistanceKm = calculateNearestFacilityDistance(region.representativePoint, facilities);
    const facilitiesWithinTwoKm = calculateFacilitiesWithinRadius(region.representativePoint, facilities, 2);

    return {
      region,
      population,
      facilitiesPerTenThousand,
      elderlyRatio,
      nearestDistanceKm,
      facilitiesWithinTwoKm,
    };
  });

  const supplyScores = winsorizedMinMax(
    raw.map(({ facilitiesPerTenThousand }) => facilitiesPerTenThousand),
    "lower-is-higher-risk",
  );
  const elderlyScores = winsorizedMinMax(raw.map(({ elderlyRatio }) => elderlyRatio));
  const distanceScores = winsorizedMinMax(raw.map(({ nearestDistanceKm }) => nearestDistanceKm));

  const records = raw.map((entry, index): AccessRecord => ({
    ...entry,
    vulnerabilityScore: medicalVulnerabilityIndex({
      supplyScarcityScore: supplyScores[index],
      elderlyDemandScore: elderlyScores[index],
      nearestDistanceScore: distanceScores[index],
      noFacilityWithin2KmScore: entry.facilitiesWithinTwoKm === 0 ? 100 : 0,
    }),
  }));

  return { records, facilities };
}

function accessMetrics(record: AccessRecord, referenceMonth: string): MetricDescriptor[] {
  return [
    metric(
      "의료취약지수",
      record.vulnerabilityScore,
      "점",
      "공급 부족 35% + 고령 수요 25% + 최근접 거리 25% + 2km 무시설 15%",
      referenceMonth,
      "경남 행정동 간 winsorized min-max 상대 점수이며 약국은 기본 제외됩니다.",
    ),
    metric(
      "인구 1만 명당 의료기관",
      record.facilitiesPerTenThousand,
      "개/1만 명",
      "의료기관 수 ÷ 총인구 × 10,000",
      referenceMonth,
      "행정동 코드에 귀속된 의료기관을 집계하며 약국은 기본 제외됩니다.",
    ),
    metric("고령인구 비율", record.elderlyRatio, "%", "65세 이상 인구 ÷ 총인구 × 100", referenceMonth, "연령 구간은 65세 이상입니다."),
    metric(
      "최근접 의료기관 직선거리",
      record.nearestDistanceKm,
      "km",
      "행정동 내부 대표점과 가장 가까운 의료기관 사이의 Turf 대권거리",
      referenceMonth,
      "도로망 이동거리나 실제 소요시간이 아닌 직선거리입니다.",
    ),
    metric(
      "2km 내 의료기관",
      record.facilitiesWithinTwoKm,
      "개",
      "행정동 내부 대표점 반경 2km 안 의료기관 수",
      referenceMonth,
      "행정동 경계를 넘는 인접 시설도 거리 기준으로 포함합니다.",
    ),
  ];
}

function regionByRequestedToken(intent: AnalysisIntent, snapshot: AnalysisSnapshot): RegionSeries | null {
  const matches = scopedRegions(intent, snapshot);
  if (matches.length > 0) {
    return [...matches].sort((left, right) => left.adm_cd2.localeCompare(right.adm_cd2))[0];
  }

  if (regionTokens(intent).length > 0) {
    return null;
  }

  return [...snapshot.regions].sort((left, right) => left.adm_cd2.localeCompare(right.adm_cd2))[0] ?? null;
}

export function rankHospitalScarcity(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const { records, facilities } = accessRecords(intent, snapshot);
  const rankedRegions = ranked(
    records.map((record) => analysisRegion(record.region, record.vulnerabilityScore, accessMetrics(record, snapshot.referenceMonth))),
    "descending",
    requestedLimit(intent, records.length),
    true,
  );

  return result({
    title: "의료 취약 지역",
    summary: `${rankedRegions.length}개 행정동을 의료 공급·고령 수요·거리·2km 접근성으로 비교했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    filteredFacilities: facilities,
    legend: VULNERABILITY_LEGEND,
    formulaNotes: [
      "인구 1만 명당 의료기관 부족 35% + 고령화 수요 25% + 최근접 거리 25% + 2km 무시설 15%",
      "연속 지표는 경남 행정동 전체의 5·95백분위 winsorized min-max로 0~100 정규화합니다.",
      "약국은 명시적으로 요청한 경우에만 의료기관 집합에 포함합니다.",
    ],
  });
}

export function rankElderlyUnderserved(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const { records, facilities } = accessRecords(intent, snapshot);
  const rankedRegions = ranked(
    records.map((record) =>
      analysisRegion(record.region, record.elderlyRatio, [
        metric("고령인구 비율", record.elderlyRatio, "%", "65세 이상 인구 ÷ 총인구 × 100", snapshot.referenceMonth, "연령 구간은 65세 이상입니다."),
        ...accessMetrics(record, snapshot.referenceMonth).slice(1),
      ]),
    ),
    "descending",
    requestedLimit(intent, records.length),
  );

  return result({
    title: "고령층 의료 접근 취약 지역",
    summary: `${rankedRegions.length}개 행정동을 고령인구 비율 순으로 정렬하고 의료 접근 지표를 함께 표시했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    filteredFacilities: facilities,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["순위는 65세 이상 인구 비율을 사용하며 의료기관 공급과 직선거리는 보조 지표로 제공합니다."],
  });
}

export function rankPopulationGrowthPressure(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const change = populationChange(region, snapshot.referenceMonth);
    return analysisRegion(region, change, [
      metric(
        "12개월 인구 증감률",
        change,
        "%",
        "(기준월 인구 - 12개월 전 인구) ÷ 12개월 전 인구 × 100",
        snapshot.referenceMonth,
        "전입·전출·자연증가의 원인을 분리하지 않은 총인구 변화입니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "인구 증가 압력",
    summary: `${rankedRegions.length}개 행정동을 12개월 인구 증감률이 높은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["기준월과 정확히 12개월 전의 총인구를 비교합니다."],
  });
}

export function rankPopulationDeclineRisk(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const growth = populationChange(region, snapshot.referenceMonth);
    const decline = growth === null ? null : -growth;
    return analysisRegion(region, decline, [
      metric(
        "12개월 인구 감소율",
        decline,
        "%",
        "(12개월 전 인구 - 기준월 인구) ÷ 12개월 전 인구 × 100",
        snapshot.referenceMonth,
        "음수 값은 같은 기간 인구가 증가했음을 뜻합니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "인구 감소 위험",
    summary: `${rankedRegions.length}개 행정동을 12개월 인구 감소율이 높은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["기준월과 정확히 12개월 전의 총인구를 비교하며 이동과 자연증가 원인을 분리하지 않습니다."],
  });
}

export function rankSingleHouseholdRisk(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const onePerson = numericValueAt(region.onePersonHouseholds, index);
    const households = numericValueAt(region.households, index);
    const ratio = percentage(onePerson, households);
    return analysisRegion(region, ratio, [
      metric(
        "1인가구 비율",
        ratio,
        "%",
        "1인가구 수 ÷ 전체 세대 수 × 100",
        snapshot.referenceMonth,
        "원자료가 없는 행정동은 추정하지 않고 순위에서 제외합니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "1인가구 비율",
    summary: `${rankedRegions.length}개 행정동을 1인가구 비율이 높은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["결측 1인가구 수는 0으로 대체하지 않고 순위에서 제외합니다."],
  });
}

export function rankDeathCount(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const deaths = numericValueAt(region.deaths, index);
    const population = numericValueAt(region.population, index);
    const perTenThousand = percentage(deaths, population) === null || population === null || population <= 0
      ? null
      : (deaths! / population) * 10_000;
    return analysisRegion(region, deaths, [
      metric(
        "기준월 사망 수",
        deaths,
        "명",
        "스냅샷 기준월 사망 등록 건수",
        snapshot.referenceMonth,
        "원인별 사망·전출·말소와 다른 통계일 수 있으며 전입·전출은 포함하지 않습니다.",
      ),
      metric(
        "인구 1만 명당 사망",
        perTenThousand,
        "명",
        "기준월 사망 수 ÷ 총인구 × 10,000",
        snapshot.referenceMonth,
        "소규모 행정동은 비율이 크게 요동칠 수 있습니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "사망 수가 많은 지역",
    summary:
      rankedRegions.length === 0
        ? "사망 수 데이터가 있는 행정동이 없습니다."
        : `${rankedRegions.length}개 행정동을 기준월 사망 수가 많은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: [
      "순위는 기준월 절대 사망 수입니다. 상세 카드의 1만 명당 지표로 규모 차이를 함께 보세요.",
      "출생−사망 자연증가와 달리 이동(전입·전출)은 반영하지 않습니다.",
    ],
  });
}

export function rankBirthCount(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const births = numericValueAt(region.births, index);
    const population = numericValueAt(region.population, index);
    const perTenThousand =
      births === null || population === null || population <= 0
        ? null
        : (births / population) * 10_000;
    return analysisRegion(region, births, [
      metric(
        "기준월 출생 수",
        births,
        "명",
        "스냅샷 기준월 출생 등록 건수",
        snapshot.referenceMonth,
        "출생 신고 시점 기준이며 실제 거주지와 다를 수 있습니다.",
      ),
      metric(
        "인구 1만 명당 출생",
        perTenThousand,
        "명",
        "기준월 출생 수 ÷ 총인구 × 10,000",
        snapshot.referenceMonth,
        "소규모 행정동은 비율이 크게 요동칠 수 있습니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "출생 수가 많은 지역",
    summary:
      rankedRegions.length === 0
        ? "출생 수 데이터가 있는 행정동이 없습니다."
        : `${rankedRegions.length}개 행정동을 기준월 출생 수가 많은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["순위는 기준월 절대 출생 수이며 전입·전출은 포함하지 않습니다."],
  });
}

export function rankNaturalDecrease(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const naturalChange = numericValueAt(region.naturalChange, index);
    const decrease = naturalChange === null ? null : -naturalChange;
    return analysisRegion(region, decrease, [
      metric(
        "자연감소(사망−출생)",
        decrease,
        "명",
        "기준월 사망 수 − 출생 수 (자연증가의 부호 반전)",
        snapshot.referenceMonth,
        "전입·전출은 포함하지 않습니다. 값이 음수면 같은 달 자연증가 상태입니다.",
      ),
      metric(
        "자연증가",
        naturalChange,
        "명",
        "출생 수 − 사망 수",
        snapshot.referenceMonth,
        "전입·전출 미포함.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));

  return result({
    title: "자연감소가 큰 지역",
    summary:
      rankedRegions.length === 0
        ? "자연증가·감소 데이터가 있는 행정동이 없습니다."
        : `${rankedRegions.length}개 행정동을 자연감소(사망−출생)가 큰 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["자연감소 = 사망 − 출생. 이동 인구는 반영하지 않습니다."],
  });
}

export function rankPopulationDensity(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const density = numericValueAt(region.populationDensity, index);
    return analysisRegion(region, density, [
      metric(
        "인구밀도",
        density,
        "명/km²",
        "총인구 ÷ 행정동 면적(km²)",
        snapshot.referenceMonth,
        "대표 면적 기준이며 실제 거주 가능 면적과 다를 수 있습니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));
  return result({
    title: "인구밀도가 높은 지역",
    summary: `${rankedRegions.length}개 행정동을 인구밀도 높은 순으로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["인구밀도 = 총인구 ÷ 행정동 면적(km²)."],
  });
}

export function rankPopulationSize(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const population = numericValueAt(region.population, index);
    return analysisRegion(region, population, [
      metric("총인구", population, "명", "기준월 주민 수", snapshot.referenceMonth, "전입·전출 순이동은 별도 지표입니다."),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));
  return result({
    title: "총인구가 많은 지역",
    summary: `${rankedRegions.length}개 행정동을 총인구 많은 순으로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["기준월 절대 인구 수 순위입니다."],
  });
}

export function rankElderlyRatio(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const analyzed = regions.map((region) => {
    const index = referenceIndex(region, snapshot.referenceMonth);
    const elderly = numericValueAt(region.elderlyPopulation, index);
    const population = numericValueAt(region.population, index);
    const ratio = percentage(elderly, population);
    return analysisRegion(region, ratio, [
      metric(
        "고령화율",
        ratio,
        "%",
        "65세 이상 인구 ÷ 총인구 × 100",
        snapshot.referenceMonth,
        "의료 공급과 결합한 취약 분석은 ‘고령 × 의료’ 질의를 사용하세요.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length));
  return result({
    title: "고령화율이 높은 지역",
    summary: `${rankedRegions.length}개 행정동을 고령인구 비율 높은 순으로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["고령화율 = 65세 이상 ÷ 총인구 × 100."],
  });
}

export function filterFacilitiesByTypeAndHours(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const facilities = filteredFacilities(intent, snapshot, true);
  const selected = regionByRequestedToken(intent, snapshot);
  const night = Boolean(intent.filters.requireNightHours);
  const weekend = Boolean(intent.filters.requireWeekendHours);
  const types = intent.filters.facilityTypes?.join("·") ?? "의료기관";

  let summary = `조건에 맞는 시설 ${facilities.length}개를 찾았습니다.`;
  if (facilities.length === 0) {
    if (night || weekend) {
      summary =
        "요청하신 운영시간 조건을 만족하는 시설 데이터가 없습니다. 운영시간 값이 비어 있는 시설은 추정하지 않고 제외합니다. 종류만 지정해 다시 물어보시면 위치를 볼 수 있습니다.";
    } else {
      summary = `요청 조건(${types})에 해당하는 시설 데이터가 현재 스냅샷에 없습니다. 다른 시설 종류나 빠른 분석으로 이어서 볼 수 있습니다.`;
    }
  }

  return result({
    title: night ? "야간 운영 의료기관" : weekend ? "주말 운영 의료기관" : "의료기관 검색",
    summary,
    selectedRegion: selected ? analysisRegion(selected, null, detailMetrics(selected, snapshot.referenceMonth)) : null,
    filteredFacilities: facilities,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: [
      "시설 종류가 명시되지 않으면 약국을 제외한 모든 의료기관 유형을 대상으로 합니다.",
      "운영시간·진료과 값이 없는 시설은 해당 조건에서 제외하며 추측하지 않습니다.",
    ],
  });
}

function districtLabel(region: RegionSeries): string {
  // "경상남도 김해시 삼계동" → 김해시
  const parts = region.adm_nm.split(/\s+/).filter(Boolean);
  const withGu = parts.find((part) => /[구현군]$/.test(part));
  return withGu ?? parts[1] ?? region.adm_nm;
}

function sumNullable(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0);
}

/**
 * District/gu-level comparison when compare tokens are present.
 * Falls back to dong list when tokens do not match.
 */
export function compareRegions(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const tokens = (intent.filters.compare ?? intent.filters.regions ?? [])
    .map((token) => token.trim())
    .filter(Boolean);
  const referenceMonth = snapshot.referenceMonth;

  if (tokens.length >= 1) {
    const groups = tokens.map((token) => ({
      token,
      matched: snapshot.regions.filter((region) => regionMatches(region, token)),
    }));
    const nonEmpty = groups.filter((group) => group.matched.length > 0);

    if (nonEmpty.length >= 1) {
      const rollup = nonEmpty.map((group) => {
        const populations = group.matched.map((region) =>
          latestValue(region, region.population, referenceMonth),
        );
        const elderly = group.matched.map((region) =>
          latestValue(region, region.elderlyPopulation, referenceMonth),
        );
        const births = group.matched.map((region) =>
          latestValue(region, region.births, referenceMonth),
        );
        const deaths = group.matched.map((region) =>
          latestValue(region, region.deaths, referenceMonth),
        );
        const population = sumNullable(populations);
        const elderlyPop = sumNullable(elderly);
        const birthSum = sumNullable(births);
        const deathSum = sumNullable(deaths);
        const natural =
          birthSum === null || deathSum === null ? null : birthSum - deathSum;
        const elderlyRatio = percentage(elderlyPop, population);
        const area = group.matched.reduce((sum, region) => sum + region.areaSquareKm, 0);
        const density = population === null || area <= 0 ? null : population / area;
        const facilityCount = snapshot.facilities.filter(
          (facility) =>
            facility.type !== "약국" &&
            group.matched.some((region) => region.adm_cd2 === facility.adm_cd2),
        ).length;
        const per10k =
          population === null || population <= 0
            ? null
            : (facilityCount / population) * 10_000;
        const rep = group.matched[0];
        const label =
          /[구현군]$/.test(group.token) || group.token.includes("구") || group.token.includes("군")
            ? group.token
            : districtLabel(rep);

        // Synthetic display name for rank panel
        const labeled = {
          ...rep,
          adm_nm: `경상남도 ${label}`,
        };

        return analysisRegion(labeled, per10k, [
          metric(
            "비교 지역",
            group.matched.length,
            "개 동",
            label,
            referenceMonth,
            `${group.matched.length}개 행정동 합산`,
          ),
          metric("총인구(합)", population, "명", "소속 행정동 총인구 합", referenceMonth, "구·군 단위 롤업"),
          metric(
            "고령비율",
            elderlyRatio,
            "%",
            "고령인구 합 ÷ 총인구 합 × 100",
            referenceMonth,
            "구·군 단위 롤업",
          ),
          metric("인구밀도", density, "명/km²", "총인구 합 ÷ 면적 합", referenceMonth, "구·군 단위 롤업"),
          metric("자연증가(합)", natural, "명", "출생 합 − 사망 합", referenceMonth, "전입·전출 미포함"),
          metric(
            "의료기관(약국 제외)",
            facilityCount,
            "개소",
            "소속 동 시설 수",
            referenceMonth,
            "데모·스냅샷 기준",
          ),
          metric(
            "인구 1만명당 의료기관",
            per10k,
            "개소",
            "의료기관 수 ÷ 총인구 × 10,000",
            referenceMonth,
            "공급 밀도 비교용",
          ),
        ]);
      });

      const ordered = ranked(rollup, "ascending", rollup.length, true);
      const labels = nonEmpty.map((group) => group.token).join(" · ");
      const dongTotal = nonEmpty.reduce((count, group) => count + group.matched.length, 0);

      return result({
        title: `지역 비교 · ${labels}`,
        summary: `${nonEmpty.length}개 구·군 단위로 인구·고령·의료 공급을 합산 비교합니다. (하위 ${dongTotal}개 행정동)`,
        rankedRegions: ordered,
        selectedRegion: ordered[0] ?? null,
        legend: SINGLE_COLOR_LEGEND,
        formulaNotes: [
          "구·군 토큰에 매칭되는 행정동 지표를 합산합니다.",
          "인구 1만명당 의료기관이 낮을수록 공급이 상대적으로 부족합니다.",
          "모든 지표는 동일 기준월을 사용합니다.",
        ],
      });
    }
  }

  const regions = scopedRegions(intent, snapshot).sort((left, right) =>
    left.adm_cd2.localeCompare(right.adm_cd2),
  );
  const compared = regions.map((region, index) => ({
    ...analysisRegion(region, null, detailMetrics(region, snapshot.referenceMonth)),
    rank: index + 1,
  }));

  return result({
    title: "지역 비교",
    summary: `${compared.length}개 행정동의 동일 기준월 지표를 비교합니다.`,
    rankedRegions: compared,
    selectedRegion: compared[0] ?? null,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["모든 지표는 같은 기준월을 사용하며 행정동 코드는 오름차순으로 표시합니다."],
  });
}

export function nearestFacilityDistance(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const regions = scopedRegions(intent, snapshot);
  const facilities = filteredFacilities(intent, snapshot, false);
  const analyzed = regions.map((region) => {
    const distance = calculateNearestFacilityDistance(region.representativePoint, facilities);
    return analysisRegion(region, distance, [
      metric(
        "최근접 의료기관 직선거리",
        distance,
        "km",
        "행정동 내부 대표점과 가장 가까운 의료기관 사이의 Turf 대권거리",
        snapshot.referenceMonth,
        "도로망 이동거리나 실제 소요시간이 아닌 직선거리입니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "descending", requestedLimit(intent, analyzed.length), true);
  const requested = regionByRequestedToken(intent, snapshot);
  const selectedRegion = requested
    ? rankedRegions.find(({ adm_cd2 }) => adm_cd2 === requested.adm_cd2) ??
      analysisRegion(requested, null, [
        metric(
          "최근접 의료기관 직선거리",
          calculateNearestFacilityDistance(requested.representativePoint, facilities),
          "km",
          "행정동 내부 대표점과 가장 가까운 의료기관 사이의 Turf 대권거리",
          snapshot.referenceMonth,
          "도로망 이동거리나 실제 소요시간이 아닌 직선거리입니다.",
        ),
      ])
    : null;

  return result({
    title: "최근접 의료기관 거리",
    summary: facilities.length === 0 ? "조건에 맞는 의료기관이 없어 거리를 계산할 수 없습니다." : `${regions.length}개 행정동의 최근접 의료기관 직선거리를 계산했습니다.`,
    rankedRegions,
    selectedRegion,
    filteredFacilities: facilities,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["약국은 명시적으로 요청한 경우에만 포함하며 Turf 대권거리를 km로 계산합니다."],
  });
}

export function countFacilitiesWithinRadius(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const radiusKm = intent.filters.radiusKm ?? 2;
  const regions = scopedRegions(intent, snapshot);
  const facilities = filteredFacilities(intent, snapshot, false);
  const analyzed = regions.map((region) => {
    const count = calculateFacilitiesWithinRadius(region.representativePoint, facilities, radiusKm);
    return analysisRegion(region, count, [
      metric(
        `${radiusKm}km 내 의료기관`,
        count,
        "개",
        `행정동 내부 대표점 반경 ${radiusKm}km 안 의료기관 수`,
        snapshot.referenceMonth,
        "행정동 경계를 넘는 인접 시설도 거리 기준으로 포함합니다.",
      ),
    ]);
  });
  const rankedRegions = ranked(analyzed, "ascending", requestedLimit(intent, analyzed.length));

  return result({
    title: `${radiusKm}km 의료기관 접근성`,
    summary: `${regions.length}개 행정동을 반경 내 의료기관 수가 적은 순서로 정렬했습니다.`,
    rankedRegions,
    selectedRegion: rankedRegions[0] ?? null,
    filteredFacilities: facilities,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["약국은 명시적으로 요청한 경우에만 포함하고 대표점 기준 Turf 대권거리를 사용합니다."],
  });
}

export function getRegionDetails(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const region = regionByRequestedToken(intent, snapshot);
  const selectedRegion = region ? analysisRegion(region, null, detailMetrics(region, snapshot.referenceMonth)) : null;
  const facilities = region
    ? snapshot.facilities.filter((facility) => facility.adm_cd2 === region.adm_cd2)
    : [];

  return result({
    title: region ? `${region.adm_nm} 상세` : "지역 상세",
    summary: region
      ? `${snapshot.referenceMonth} 기준 인구·세대·연령·자연증가 지표입니다.`
      : "요청하신 지역명과 일치하는 행정동 데이터가 없습니다. 구·군 이름(예: 창원시 의창구, 김해시)으로 다시 물어봐 주세요.",
    rankedRegions: selectedRegion ? [{ ...selectedRegion, rank: 1 }] : [],
    selectedRegion,
    filteredFacilities: facilities,
    legend: SINGLE_COLOR_LEGEND,
    formulaNotes: ["자연증가는 출생 수에서 사망 수를 뺀 값이며 전입·전출은 포함하지 않습니다."],
  });
}

export const toolRegistry = {
  rankHospitalScarcity,
  rankElderlyUnderserved,
  rankPopulationGrowthPressure,
  rankPopulationDeclineRisk,
  rankSingleHouseholdRisk,
  rankDeathCount,
  rankBirthCount,
  rankNaturalDecrease,
  rankPopulationDensity,
  rankPopulationSize,
  rankElderlyRatio,
  filterFacilitiesByTypeAndHours,
  compareRegions,
  nearestFacilityDistance,
  countFacilitiesWithinRadius,
  getRegionDetails,
} satisfies Record<ToolName, AnalysisTool>;

export const TOOL_REGISTRY = toolRegistry;

function assertUniqueRegionCodes(snapshot: AnalysisSnapshot): void {
  const codes = new Set<string>();
  for (const region of snapshot.regions) {
    if (codes.has(region.adm_cd2)) {
      throw new Error(`Duplicate administrative region code: ${region.adm_cd2}`);
    }
    codes.add(region.adm_cd2);
  }
}

export function executeAnalysisIntent(intent: AnalysisIntent, snapshot: AnalysisSnapshot): AnalysisResult {
  const validatedIntent = AnalysisIntentSchema.parse(intent);
  assertUniqueRegionCodes(snapshot);
  return toolRegistry[validatedIntent.tool](validatedIntent, snapshot);
}
