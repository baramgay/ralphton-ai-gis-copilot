import { describe, expect, test } from "vitest";

import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";
import { parseIntentWithRules, resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { executeAnalysisIntent } from "@/lib/analysis/tool-registry";
import type { AnalysisSnapshot, Facility, RegionSeries } from "@/lib/domain/schemas";

/**
 * Regression battery for the natural-language routing defects diagnosed in the
 * 랄프톤 NL-routing audit: bare-magnitude queries no longer default to a vital-stats
 * rank tool, density/size are disambiguated, natural increase/decrease polarity is
 * kept distinct, bare "안에/이내" no longer forces the radius tool, scarcity beats a
 * facility-type mention, nearest/farthest distance direction is honored, and
 * out-of-scope place names surface a notice instead of an unscoped ranking.
 */

const months = [
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
];

function region(
  adm_cd2: string,
  adm_nm: string,
  options: {
    population?: number;
    births?: number;
    deaths?: number;
    lat?: number;
    lng?: number;
  } = {},
): RegionSeries {
  const population = options.population ?? 1000;
  const births = options.births ?? 5;
  const deaths = options.deaths ?? 5;
  const naturalChange = births - deaths;

  return {
    adm_cd2,
    adm_nm,
    representativePoint: { lat: options.lat ?? 35, lng: options.lng ?? 128 },
    areaSquareKm: 2,
    months,
    population: Array(13).fill(population),
    households: Array(13).fill(400),
    populationDensity: Array(13).fill(population / 2),
    youthPopulation: Array(13).fill(100),
    workingAgePopulation: Array(13).fill(Math.max(population - 300, 0)),
    elderlyPopulation: Array(13).fill(200),
    onePersonHouseholds: Array(13).fill(100),
    births: Array(13).fill(births),
    deaths: Array(13).fill(deaths),
    naturalChange: Array(13).fill(naturalChange),
  };
}

function facility(id: string, adm_cd2: string, adm_nm: string, lat: number, lng: number): Facility {
  return {
    id,
    name: `${adm_nm} 병원`,
    type: "병원",
    adm_cd2,
    adm_nm,
    lat,
    lng,
    specialties: null,
    hours: null,
    address: null,
    phone: null,
  };
}

function snapshot(regions: RegionSeries[], facilities: Facility[] = []): AnalysisSnapshot {
  return {
    mode: "demo",
    referenceMonth: "2026-06",
    months,
    regions,
    facilities,
    sourceNotes: ["nl-routing test fixture"],
  };
}

describe("nl-routing: defect fixes", () => {
  test("defect 1 — 사람 많은 데 no longer defaults to rankDeathCount", () => {
    const resolved = resolveQueryWithRules("사람 많은 데");
    if (resolved.kind === "intent") {
      expect(resolved.intent.tool).not.toBe("rankDeathCount");
    } else {
      expect(resolved.kind).toBe("unsupported");
    }
  });

  test("defect 1 — 낮에 사람 많은 지역 / 세대수 많은 동 also avoid rankDeathCount", () => {
    for (const query of ["낮에 사람 많은 지역", "세대수 많은 동"]) {
      const intent = parseIntentWithRules(query);
      expect(intent?.tool, query).not.toBe("rankDeathCount");
    }
  });

  test("defect 2 — 진주시 인구 routes to rankPopulationSize (not density)", () => {
    const intent = parseIntentWithRules("진주시 인구");
    expect(intent?.tool).toBe("rankPopulationSize");
    expect(() => AnalysisIntentSchema.parse(intent)).not.toThrow();
  });

  test("defect 2 — 인구 많은 지역 routes to rankPopulationSize", () => {
    expect(parseIntentWithRules("인구 많은 지역")?.tool).toBe("rankPopulationSize");
  });

  test("defect 2 — 인구밀도 높은 곳 still routes to rankPopulationDensity", () => {
    expect(parseIntentWithRules("인구밀도 높은 곳")?.tool).toBe("rankPopulationDensity");
  });

  test("defect 3 — 자연증가 높은 곳 routes to rankNaturalIncrease, ranked by descending naturalChange", () => {
    const intent = parseIntentWithRules("자연증가 높은 곳");
    expect(intent?.tool).toBe("rankNaturalIncrease");
    expect(() => AnalysisIntentSchema.parse(intent)).not.toThrow();

    const highIncrease = region("4810000101", "경상남도 증가동", { births: 50, deaths: 5 }); // +45
    const decreasing = region("4810000102", "경상남도 감소동", { births: 5, deaths: 50 }); // -45
    const neutral = region("4810000103", "경상남도 보통동", { births: 10, deaths: 10 }); // 0

    const result = executeAnalysisIntent(intent!, snapshot([decreasing, neutral, highIncrease]));

    expect(result.rankedRegions[0]?.adm_cd2).toBe(highIncrease.adm_cd2);
    expect(result.rankedRegions[0]?.score).toBe(45);
    const scores = result.rankedRegions.map((r) => r.score ?? Number.NEGATIVE_INFINITY);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test("defect 3 — 자연감소가 큰 곳 keeps ranking by decrease (regression guard)", () => {
    expect(parseIntentWithRules("자연감소가 큰 곳")?.tool).toBe("rankNaturalDecrease");
  });

  test("defect 4 — 거창군 안에서 no longer forces the radius facility-count tool", () => {
    const intent = parseIntentWithRules("거창군 안에서");
    expect(intent?.tool).not.toBe("countFacilitiesWithinRadius");
  });

  test("defect 4 — explicit radius queries still route to countFacilitiesWithinRadius", () => {
    expect(parseIntentWithRules("2km 안 병원 적은 곳")?.tool).toBe("countFacilitiesWithinRadius");
    expect(parseIntentWithRules("2키로 안 병원")?.tool).toBe("countFacilitiesWithinRadius");
  });

  test("defect 8 — scarcity wording wins over a bare facility-type mention", () => {
    expect(parseIntentWithRules("병원 부족한데 어디임?")?.tool).toBe("rankHospitalScarcity");
    expect(parseIntentWithRules("어디가 병원 부족하냐")?.tool).toBe("rankHospitalScarcity");
  });

  test("defect 9 — 가장 가까운 병원 returns the closest region first", () => {
    const intent = parseIntentWithRules("가장 가까운 병원");
    expect(intent?.tool).toBe("nearestFacilityDistance");

    const nearFacility = facility("hospital-near", "4810000201", "경상남도 근접동", 35, 128);
    const near = region("4810000201", "경상남도 근접동", { lat: 35, lng: 128 });
    const far = region("4810000202", "경상남도 원거리동", { lat: 36, lng: 129 });

    const result = executeAnalysisIntent(intent!, snapshot([far, near], [nearFacility]));

    expect(result.rankedRegions[0]?.adm_cd2).toBe(near.adm_cd2);
    const scores = result.rankedRegions.map((r) => r.score ?? Number.POSITIVE_INFINITY);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  test("defect 9 — 병원까지 먼 동 keeps farthest-first ranking (regression guard)", () => {
    const intent = parseIntentWithRules("병원까지 먼 동");
    expect(intent?.tool).toBe("nearestFacilityDistance");

    const nearFacility = facility("hospital-near", "4810000201", "경상남도 근접동", 35, 128);
    const near = region("4810000201", "경상남도 근접동", { lat: 35, lng: 128 });
    const far = region("4810000202", "경상남도 원거리동", { lat: 36, lng: 129 });

    const result = executeAnalysisIntent(intent!, snapshot([near, far], [nearFacility]));

    expect(result.rankedRegions[0]?.adm_cd2).toBe(far.adm_cd2);
  });

  test("defect 10 — 해운대구 인구 surfaces an out-of-scope notice", () => {
    const resolved = resolveQueryWithRules("해운대구 인구");
    expect(resolved.kind).toBe("unsupported");
    if (resolved.kind === "unsupported") {
      expect(resolved.notice).toContain("경남");
    }
  });

  test("defect 10 — queries without a place name are unaffected", () => {
    const intent = parseIntentWithRules("의료 취약 지역");
    expect(intent?.tool).toBe("rankHospitalScarcity");
  });
});

describe("nl-routing: regression guards (known-good routing)", () => {
  test("의료 취약 지역 → rankHospitalScarcity", () => {
    expect(parseIntentWithRules("의료 취약 지역")?.tool).toBe("rankHospitalScarcity");
  });

  test("약국 찾아줘 → filterFacilitiesByTypeAndHours", () => {
    expect(parseIntentWithRules("약국 찾아줘")?.tool).toBe("filterFacilitiesByTypeAndHours");
  });

  test("진주시와 통영시 인구 비교 → compareRegions", () => {
    const intent = parseIntentWithRules("진주시와 통영시 인구 비교");
    expect(intent?.tool).toBe("compareRegions");
  });
});
