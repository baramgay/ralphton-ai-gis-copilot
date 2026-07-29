import { describe, expect, test } from "vitest";

import { resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { rollupToDistricts } from "@/lib/analysis/tool-registry";
import type { RegionSeries } from "@/lib/domain/schemas";

/*
 * 공공 지표 6종이 "시군구별"을 물어도 전부 행정동 순위를 답하고 있었다(prod 실측).
 * `adminLevel`은 스키마에만 있고 아무도 세우지 않았다. 민간 큐브 경로만 정상이었다.
 *
 * 가장 위험한 것은 **비율**이다. 읍면동 비율을 평균 내면 인구 100명짜리 면과 5만 명짜리
 * 동이 같은 무게가 된다. 성분을 더해 두면 각 도구의 기존 공식이 그대로 인구 가중 비율을
 * 낸다 — 그것이 이 합산의 요점이다.
 */
function dong(overrides: Partial<RegionSeries> & { adm_cd2: string; adm_nm: string }): RegionSeries {
  const flat = (value: number) => Array.from({ length: 13 }, () => value);
  return {
    representativePoint: { lat: 35.2, lng: 128.6 },
    areaSquareKm: 10,
    months: Array.from({ length: 13 }, (_, index) => `2025-${String((index % 12) + 1).padStart(2, "0")}`),
    population: flat(1000),
    households: flat(400),
    populationDensity: flat(100),
    youthPopulation: flat(200),
    workingAgePopulation: flat(600),
    elderlyPopulation: flat(200),
    onePersonHouseholds: flat(150),
    births: flat(5),
    deaths: flat(8),
    naturalChange: flat(-3),
    ...overrides,
  };
}

describe("rollupToDistricts", () => {
  const big = dong({
    adm_cd2: "4825012000",
    adm_nm: "경상남도 김해시 큰동",
    population: Array.from({ length: 13 }, () => 50_000),
    elderlyPopulation: Array.from({ length: 13 }, () => 5_000), // 10%
    areaSquareKm: 20,
  });
  const small = dong({
    adm_cd2: "4825013000",
    adm_nm: "경상남도 김해시 작은면",
    population: Array.from({ length: 13 }, () => 100),
    elderlyPopulation: Array.from({ length: 13 }, () => 90), // 90%
    areaSquareKm: 80,
  });

  test("같은 시군구로 묶는다", () => {
    const rolled = rollupToDistricts([big, small]);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].adm_nm).toBe("경상남도 김해시");
  });

  test("절대량은 더한다", () => {
    const [kimhae] = rollupToDistricts([big, small]);
    expect(kimhae.population[0]).toBe(50_100);
    expect(kimhae.births[0]).toBe(10);
    expect(kimhae.areaSquareKm).toBe(100);
  });

  test("비율은 성분 합에서 나와야 한다 — 단순 평균이면 50%가 된다", () => {
    const [kimhae] = rollupToDistricts([big, small]);
    const ratio = (kimhae.elderlyPopulation[0] / kimhae.population[0]) * 100;
    // 인구 가중: (5,000+90) / 50,100 ≈ 10.2%. 단순 평균이면 (10+90)/2 = 50%.
    expect(ratio).toBeCloseTo(10.16, 1);
    expect(ratio).toBeLessThan(20);
  });

  test("인구밀도는 다시 계산한다", () => {
    const [kimhae] = rollupToDistricts([big, small]);
    expect(kimhae.populationDensity[0]).toBeCloseTo(501, 0);
  });

  test("대표점은 인구 가중 — 사람 없는 넓은 면으로 끌려가지 않는다", () => {
    const north = dong({ adm_cd2: "4825012000", adm_nm: "경상남도 김해시 큰동", representativePoint: { lat: 35.0, lng: 128.0 }, population: Array.from({ length: 13 }, () => 50_000) });
    const far = dong({ adm_cd2: "4825013000", adm_nm: "경상남도 김해시 작은면", representativePoint: { lat: 36.0, lng: 129.0 }, population: Array.from({ length: 13 }, () => 100) });
    const [kimhae] = rollupToDistricts([north, far]);
    expect(kimhae.representativePoint.lat).toBeCloseTo(35.002, 2);
  });

  test("1인가구는 하나라도 결측이면 시군구도 결측 — 있는 것만 더하지 않는다", () => {
    const missing = dong({
      adm_cd2: "4825013000",
      adm_nm: "경상남도 김해시 작은면",
      onePersonHouseholds: Array.from({ length: 13 }, () => null),
    });
    const [kimhae] = rollupToDistricts([big, missing]);
    expect(kimhae.onePersonHouseholds[0]).toBeNull();
  });

  test("서로 다른 시군구는 따로 남는다", () => {
    const jinju = dong({ adm_cd2: "4817012000", adm_nm: "경상남도 진주시 어떤동" });
    const rolled = rollupToDistricts([big, small, jinju]);
    expect(rolled.map((r) => r.adm_nm).sort()).toEqual(["경상남도 김해시", "경상남도 진주시"]);
  });
});

describe("시군구 단위 배선", () => {
  test.each([
    "총인구 많은 시군구",
    "고령비율 높은 시군구",
    "세대수 많은 시군구",
    "출생 많은 시군구",
    "1인가구 많은 시군구",
    "인구밀도 높은 시군구",
  ])("합산 가능한 도구는 시군구로 답한다: %s", (query) => {
    const parsed = resolveQueryWithRules(query);
    expect(parsed.intent?.adminLevel).toBe("sgg");
    expect(parsed.notice).not.toMatch(/행정동/);
  });

  test.each(["총인구 많은 동", "고령비율 높은 읍면동"])(
    "시군구를 말하지 않으면 행정동 그대로: %s",
    (query) => {
      expect(resolveQueryWithRules(query).intent?.adminLevel).toBeUndefined();
    },
  );

  test("시설 거리 도구는 합치지 않는다 — 시군구 대표점의 최근접 병원은 뜻이 없다", () => {
    const parsed = resolveQueryWithRules("시군구별 2km 안에 병원 많은 곳");
    expect(parsed.intent?.adminLevel).toBeUndefined();
  });

  test("합칠 수 없으면 그 사실을 밝힌다 — 말없이 다른 단위로 답하지 않는다", () => {
    const parsed = resolveQueryWithRules("의료 취약한 시군구");
    expect(parsed.intent?.adminLevel).toBeUndefined();
    expect(parsed.notice).toMatch(/시군구로 합칠 수 없어/);
  });
});

describe("시군구는 전부 보여 준다", () => {
  test("22개가 20행 상한에 잘리지 않는다", () => {
    // 상한 20은 305개 읍면동에서 "상위 20"을 뜻한다. 시군구는 통틀어 22개뿐이라
    // 같은 상한을 걸면 2개가 화면에도 CSV에도 없이 사라진다(prod 실측).
    const parsed = resolveQueryWithRules("총인구 많은 시군구");
    expect(parsed.intent?.filters.limit).toBeGreaterThanOrEqual(22);
  });

  test("행정동 질의의 상한은 그대로 20", () => {
    expect(resolveQueryWithRules("총인구 많은 동").intent?.filters.limit).toBe(20);
  });

  test("\"5곳만\"은 이 층이 아니라 화면 표시 상한이 자른다", () => {
    // 공공 경로의 intent.limit은 "분석 대상 모수"고, 몇 개를 보여 줄지는 화면이 정한다.
    // 여기서 5로 줄이면 22개 중 5개만 분석하게 되어 순위 자체가 달라진다.
    const parsed = resolveQueryWithRules("총인구 많은 시군구 5곳만");
    expect(parsed.intent?.filters.limit).toBeGreaterThanOrEqual(22);
  });
});
