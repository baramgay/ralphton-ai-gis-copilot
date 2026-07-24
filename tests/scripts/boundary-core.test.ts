import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { buildBoundaryMetadata, discoverLatestVersion, extractBusan, extractGyeongnam, validateBoundaryCollection } from "../../scripts/lib/boundary-core.mjs";

type Position = [number, number];

type BoundaryFeature = {
  type: "Feature";
  properties: Record<string, string>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown[];
  };
};

type BoundaryCollection = {
  type: "FeatureCollection";
  name: string;
  crs: {
    type: "name";
    properties: { name: string };
  };
  features: BoundaryFeature[];
};

function squareRing(index: number): Position[] {
  const longitude = 128.9 + (index % 10) * 0.01;
  const latitude = 35 + Math.floor(index / 10) * 0.01;

  return [
    [longitude, latitude],
    [longitude + 0.005, latitude],
    [longitude + 0.005, latitude + 0.005],
    [longitude, latitude + 0.005],
    [longitude, latitude],
  ];
}

function makeFeature(index: number, city = "부산광역시"): BoundaryFeature {
  return {
    type: "Feature",
    properties: {
      adm_nm: `${city} 테스트구 테스트동${index}`,
      adm_cd: String(21_000_000 + index),
      adm_cd2: String(2_600_000_000 + index),
      sgg: "26110",
      sido: "26",
      sidonm: city,
      sggnm: "테스트구",
    },
    geometry: {
      type: "Polygon",
      coordinates: [squareRing(index)],
    },
  };
}

function makeValidCollection(count = 150): BoundaryCollection {
  return {
    type: "FeatureCollection",
    name: "HangJeongDong_ver20260701",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    },
    features: Array.from({ length: count }, (_, index) => makeFeature(index)),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("discoverLatestVersion", () => {
  test("selects the newest verYYYYMMDD directory", () => {
    expect(
      discoverLatestVersion([
        { type: "dir", name: "ver20260401" },
        { type: "dir", name: "ver20260701" },
      ]),
    ).toBe("20260701");
  });

  test("ignores files and malformed directory names", () => {
    expect(
      discoverLatestVersion([
        { type: "file", name: "ver20990101" },
        { type: "dir", name: "archive" },
        { type: "dir", name: "ver20260701-copy" },
        { type: "dir", name: "ver20260401" },
      ]),
    ).toBe("20260401");
  });

  test("rejects an API response without a version directory", () => {
    expect(() => discoverLatestVersion([{ type: "file", name: "README.md" }])).toThrow(
      /버전 디렉터리/,
    );
  });
});

describe("extractBusan", () => {
  test("keeps only features whose administrative name starts with 부산광역시", () => {
    const collection = makeValidCollection(2);
    collection.features.push(makeFeature(2, "서울특별시"));

    const result = extractBusan(collection);

    expect(result.features).toHaveLength(2);
    expect(
      result.features.every((feature: BoundaryFeature) =>
        feature.properties.adm_nm.startsWith("부산광역시"),
      ),
    ).toBe(true);
    expect(result.crs).toEqual(collection.crs);
  });

  test("rejects a collection with no 부산 features", () => {
    const collection = makeValidCollection(1);
    collection.features[0] = makeFeature(0, "서울특별시");

    expect(() => extractBusan(collection)).toThrow(/부산.*없/);
  });
});

describe("extractGyeongnam", () => {
  function makeGyeongnamFeature(index: number): BoundaryFeature {
    const feature = makeFeature(index, "경상남도");
    feature.properties.adm_cd2 = String(4_812_000_000 + index);
    feature.properties.sgg = "48120";
    feature.properties.sido = "48";
    feature.properties.sggnm = "창원시 의창구";
    return feature;
  }

  test("keeps only features whose adm_cd2 starts with 48", () => {
    const collection = makeValidCollection(2); // 부산 features (adm_cd2 26...)
    collection.features.push(makeGyeongnamFeature(0), makeGyeongnamFeature(1));

    const result = extractGyeongnam(collection);

    expect(result.features).toHaveLength(2);
    expect(
      result.features.every((feature: BoundaryFeature) =>
        feature.properties.adm_cd2.startsWith("48"),
      ),
    ).toBe(true);
    expect(result.crs).toEqual(collection.crs);
  });

  test("rejects a collection with no 경남 features", () => {
    const collection = makeValidCollection(1); // 부산 only

    expect(() => extractGyeongnam(collection)).toThrow(/경상남도.*없/);
  });
});

describe("validateBoundaryCollection", () => {
  test("summarizes a valid CRS84 부산 collection", () => {
    const summary = validateBoundaryCollection(makeValidCollection());

    expect(summary.featureCount).toBe(150);
    expect(summary.administrativeDongCodes).toHaveLength(150);
    expect(summary.administrativeDongCodes[0]).toBe("2600000000");
    expect(summary.bbox).toEqual([128.9, 35, 128.995, 35.145]);
  });

  test("accepts EPSG:4326 coordinates", () => {
    const collection = makeValidCollection();
    collection.crs.properties.name = "urn:ogc:def:crs:EPSG::4326";

    expect(validateBoundaryCollection(collection).featureCount).toBe(150);
  });

  test("rejects a CRS identifier that only starts with EPSG:4326", () => {
    const collection = makeValidCollection();
    collection.crs.properties.name = "urn:ogc:def:crs:EPSG::43260";

    expect(() => validateBoundaryCollection(collection)).toThrow(/CRS/);
  });

  test("rejects a nonnumeric third ordinate", () => {
    const collection = makeValidCollection();
    collection.features[0].geometry.coordinates = [
      squareRing(0).map(([longitude, latitude]) => [longitude, latitude, "높이"]),
    ];

    expect(() => validateBoundaryCollection(collection)).toThrow(/좌표/);
  });

  test("rejects a Polygon hole outside its exterior ring", () => {
    const collection = makeValidCollection();
    collection.features[0].geometry.coordinates = [
      [
        [128.9, 35],
        [128.95, 35],
        [128.95, 35.05],
        [128.9, 35.05],
        [128.9, 35],
      ],
      [
        [129.1, 35.1],
        [129.11, 35.1],
        [129.11, 35.11],
        [129.1, 35.11],
        [129.1, 35.1],
      ],
    ];

    expect(() => validateBoundaryCollection(collection)).toThrow(/hole.*외부 ring/);
  });

  test("rejects a Polygon hole that crosses its exterior ring", () => {
    const collection = makeValidCollection();
    collection.features[0].geometry.coordinates = [
      [
        [128.9, 35],
        [128.95, 35],
        [128.95, 35.05],
        [128.9, 35.05],
        [128.9, 35],
      ],
      [
        [128.94, 35.02],
        [128.96, 35.02],
        [128.96, 35.03],
        [128.94, 35.03],
        [128.94, 35.02],
      ],
    ];

    expect(() => validateBoundaryCollection(collection)).toThrow(/hole.*외부 ring/);
  });

  test.each([
    ["FeatureCollection 형식", (collection: BoundaryCollection) => Object.assign(collection, { type: "Feature" })],
    ["CRS", (collection: BoundaryCollection) => (collection.crs.properties.name = "EPSG:3857")],
    ["150개 이상", (collection: BoundaryCollection) => collection.features.pop()],
    [
      "필수 문자열 속성",
      (collection: BoundaryCollection) => (collection.features[0].properties.sggnm = ""),
    ],
    [
      "8자리",
      (collection: BoundaryCollection) => (collection.features[0].properties.adm_cd = "123"),
    ],
    [
      "10자리",
      (collection: BoundaryCollection) => (collection.features[0].properties.adm_cd2 = "12345678"),
    ],
    [
      "중복",
      (collection: BoundaryCollection) =>
        (collection.features[1].properties.adm_cd2 = collection.features[0].properties.adm_cd2),
    ],
    [
      "Polygon 또는 MultiPolygon",
      (collection: BoundaryCollection) =>
        Object.assign(collection.features[0].geometry, {
          type: "Point",
          coordinates: [129, 35],
        }),
    ],
    [
      "빈 좌표",
      (collection: BoundaryCollection) => (collection.features[0].geometry.coordinates = []),
    ],
    [
      "부산·경남 범위",
      (collection: BoundaryCollection) =>
        (collection.features[0].geometry.coordinates = [
          [
            [127, 35],
            [127.1, 35],
            [127.1, 35.1],
            [127, 35.1],
            [127, 35],
          ],
        ]),
    ],
    [
      "닫히지 않은 ring",
      (collection: BoundaryCollection) =>
        (collection.features[0].geometry.coordinates = [squareRing(0).slice(0, -1)]),
    ],
    [
      "유효하지 않은 geometry",
      (collection: BoundaryCollection) =>
        (collection.features[0].geometry.coordinates = [
          [
            [128.9, 35],
            [128.91, 35.01],
            [128.9, 35.01],
            [128.91, 35],
            [128.9, 35],
          ],
        ]),
    ],
  ])("rejects %s", (message, mutate) => {
    const collection = clone(makeValidCollection());
    mutate(collection);

    expect(() => validateBoundaryCollection(collection)).toThrow(new RegExp(message));
  });
});

describe("buildBoundaryMetadata", () => {
  test("hashes the exact final bytes and records sorted codes and UTC context", () => {
    const bytes = new TextEncoder().encode("final 부산 GeoJSON bytes\n");
    const metadata = buildBoundaryMetadata(bytes, {
      version: "20260701",
      sourceUrl:
        "https://raw.githubusercontent.com/vuski/admdongkor/main/ver20260701/HangJeongDong_ver20260701.geojson",
      downloadedAt: "2026-07-16T01:02:03.000Z",
      administrativeDongCodes: ["2611052000", "2611051000"],
    });

    expect(metadata).toEqual({
      version: "20260701",
      sourceUrl:
        "https://raw.githubusercontent.com/vuski/admdongkor/main/ver20260701/HangJeongDong_ver20260701.geojson",
      downloadedAt: "2026-07-16T01:02:03.000Z",
      crs: "EPSG:4326",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      featureCount: 2,
      administrativeDongCodes: ["2611051000", "2611052000"],
    });
  });

  test.each([
    ["버전", { version: "latest" }],
    ["URL", { sourceUrl: "https://example.com/file.geojson" }],
    ["UTC", { downloadedAt: "2026-07-16 10:02:03" }],
    ["10자리", { administrativeDongCodes: ["26110510"] }],
    ["중복", { administrativeDongCodes: ["2611051000", "2611051000"] }],
  ])("rejects invalid metadata %s context", (message, override) => {
    expect(() =>
      buildBoundaryMetadata(new Uint8Array([1]), {
        version: "20260701",
        sourceUrl:
          "https://raw.githubusercontent.com/vuski/admdongkor/main/ver20260701/HangJeongDong_ver20260701.geojson",
        downloadedAt: "2026-07-16T01:02:03.000Z",
        administrativeDongCodes: ["2611051000"],
        ...override,
      }),
    ).toThrow(new RegExp(message));
  });
});

describe("generated boundary artifact", () => {
  test("contains no line-ending bytes that Git can rewrite after checkout", async () => {
    const projectRoot = process.cwd();
    const metadata = JSON.parse(
      await readFile(path.join(projectRoot, "public", "data", "boundary-metadata.json"), "utf8"),
    ) as { crs?: string; version: string };
    expect(metadata.crs).toBe("EPSG:4326");
    const bytes = await readFile(
      path.join(
        projectRoot,
        "public",
        "data",
        `busan-administrative-dong-${metadata.version}.geojson`,
      ),
    );

    expect(bytes.includes(0x0a)).toBe(false);
    expect(bytes.includes(0x0d)).toBe(false);
  });

  test("contains only 경상남도 (adm_cd2 prefix 48) administrative dongs", async () => {
    const projectRoot = process.cwd();
    const metadata = JSON.parse(
      await readFile(path.join(projectRoot, "public", "data", "boundary-metadata.json"), "utf8"),
    ) as { version: string; featureCount: number };
    const collection = JSON.parse(
      await readFile(
        path.join(projectRoot, "public", "data", `administrative-dong-${metadata.version}.geojson`),
        "utf8",
      ),
    ) as BoundaryCollection;

    expect(collection.features).toHaveLength(305);
    expect(metadata.featureCount).toBe(305);
    expect(
      collection.features.every((feature) => feature.properties.adm_cd2.startsWith("48")),
    ).toBe(true);
    expect(
      collection.features.some((feature) => feature.properties.adm_cd2.startsWith("26")),
    ).toBe(false);
  });
});
