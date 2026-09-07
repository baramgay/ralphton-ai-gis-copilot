import { describe, expect, test } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { buildSggCollection, validateSggCollection } from "../../scripts/lib/sgg-boundary.mjs";

type Ring = [number, number][];

function squareAt(lng: number, lat: number, size = 0.01): Ring {
  return [
    [lng, lat],
    [lng + size, lat],
    [lng + size, lat + size],
    [lng, lat + size],
    [lng, lat],
  ];
}

function dongFeature(code: string, sggnm: string, ring: Ring) {
  return {
    type: "Feature",
    properties: {
      adm_nm: `경상남도 ${sggnm} 테스트동`,
      adm_cd: "38000000",
      adm_cd2: code,
      sgg: code.slice(0, 5),
      sido: "48",
      sidonm: "경상남도",
      sggnm,
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/*
 * 맞닿은 두 칸(A·B)은 내부 경계가 지워져 폴리곤 1개가 되어야 한다.
 * 지워지지 않으면 시군구 지도에 동 경계가 그대로 남아 이 산출물의 존재 이유가 없다.
 */
const dongCollection = {
  type: "FeatureCollection",
  features: [
    dongFeature("4817000001", "갑시", squareAt(128, 35)),
    dongFeature("4817000002", "갑시", squareAt(128.01, 35)),
    dongFeature("4822000001", "을시", squareAt(128.05, 35)),
  ],
};

type BuiltSgg = {
  features: {
    properties: { adm_cd2: string; adm_nm: string };
    geometry: { type: string; coordinates: unknown[] };
  }[];
};

describe("buildSggCollection", () => {
  test("시군구당 Feature 1개(MultiPolygon)로 묶는다", () => {
    const sgg: BuiltSgg = buildSggCollection(dongCollection);
    expect(sgg.features).toHaveLength(2);
    expect(sgg.features.map((feature) => feature.properties.adm_cd2)).toEqual(["48170", "48220"]);
    expect(sgg.features.map((feature) => feature.properties.adm_nm)).toEqual([
      "경상남도 갑시",
      "경상남도 을시",
    ]);
    for (const feature of sgg.features) {
      expect(feature.geometry.type).toBe("MultiPolygon");
    }
  });

  test("맞닿은 동 사이 내부 경계를 지운다", () => {
    const sgg: BuiltSgg = buildSggCollection(dongCollection);
    const merged = sgg.features.find((feature) => feature.properties.adm_cd2 === "48170");
    expect(merged).toBeDefined();
    // 합쳐지지 않았으면 폴리곤이 2개로 남는다.
    expect(merged!.geometry.coordinates).toHaveLength(1);
  });

  test("입력이 깨지면 dissolve 전에 던진다", () => {
    expect(() => buildSggCollection({ type: "FeatureCollection", features: [] })).toThrow();
    expect(() =>
      buildSggCollection({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { adm_cd2: "짧음" }, geometry: null }],
      }),
    ).toThrow();
  });
});

describe("validateSggCollection", () => {
  test("행정동 접두와 1:1로 맞으면 통과한다", () => {
    const sgg = buildSggCollection(dongCollection);
    expect(validateSggCollection(sgg, ["48170", "48220"])).toMatchObject({ featureCount: 2 });
  });

  test("시군구가 빠지거나 코드가 어긋나면 던진다", () => {
    const sgg = buildSggCollection(dongCollection);
    expect(() => validateSggCollection(sgg, ["48170"])).toThrow();
    expect(() => validateSggCollection(sgg, ["48170", "99999"])).toThrow();
  });

  test("중복 코드는 던진다", () => {
    const sgg = buildSggCollection(dongCollection);
    const tampered = { ...sgg, features: [...sgg.features, sgg.features[0]] };
    expect(() => validateSggCollection(tampered, ["48170", "48220"])).toThrow();
  });
});
