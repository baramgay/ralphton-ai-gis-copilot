import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

/*
 * 시군구 dissolve 산출물은 커밋된 파일이다. 빌드·배포가 이 파일을 그대로 싣고,
 * 지도는 행정동 파일 대신 이것을 그린다. 재생성 없이 파일만 바뀌면(잘못된
 * dissolve·수작업) 지도와 순위가 어긋나므로, 행정동 파일과의 정합을 여기서 잰다.
 */
const ROOT = process.cwd();
const VERSION = "20260701";

type SggFeature = {
  properties: { adm_cd2: string; adm_nm: string };
  geometry: { type: string; coordinates: unknown[] };
};

function readJson(relativePath: string): { features: SggFeature[]; sgg: { featureCount: number; sha256: string } } {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

describe("시군구 경계 산출물", () => {
  test("행정동 접두와 1:1로 맞는다", () => {
    const dong = readJson(`public/data/administrative-dong-${VERSION}.geojson`);
    const sgg = readJson(`public/data/administrative-sgg-${VERSION}.geojson`);
    const expected = [...new Set(dong.features.map((feature) => feature.properties.adm_cd2.slice(0, 5)))].sort();
    const actual = sgg.features.map((feature) => feature.properties.adm_cd2).sort();
    expect(actual).toEqual(expected);
    expect(sgg.features.length).toBeGreaterThanOrEqual(18);
  });

  test("시군구당 Feature 1개, 이름은 경상남도로 시작한다", () => {
    const sgg = readJson(`public/data/administrative-sgg-${VERSION}.geojson`);
    for (const feature of sgg.features) {      expect(feature.geometry.type).toBe("MultiPolygon");
      expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
      expect(feature.properties.adm_nm.startsWith("경상남도 ")).toBe(true);
    }
  });

  test("메타데이터의 시군구 해시가 파일과 일치한다", () => {
    const metadata = readJson("public/data/boundary-metadata.json");
    const bytes = readFileSync(join(ROOT, `public/data/administrative-sgg-${VERSION}.geojson`));
    expect(metadata.sgg.featureCount).toBe(
      readJson(`public/data/administrative-sgg-${VERSION}.geojson`).features.length,
    );
    expect(metadata.sgg.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
