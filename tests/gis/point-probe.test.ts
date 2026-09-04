import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import type { BoundaryCollection, BoundaryFeature } from "@/components/copilot/types";
import { findContainingRegion, pointInFeature, probeRadius } from "@/lib/gis/point-probe";

/*
 * 고정물이 아니라 **실제 경계 자료**로 잰다.
 *
 * 창원 5개 구 접기가 검사는 통과하고 배포본에서는 헛돌았던 이유가 고정물이었다 —
 * 「창원시 의창구」라고 공백을 넣어 뒀는데 실제 이름에는 공백이 없었다. 여기서는
 * 305개 동을 그대로 읽어, 검사가 자기가 만든 세계만 지키는 일이 없게 한다.
 */
let boundary: BoundaryCollection;

beforeAll(() => {
  const path = join(process.cwd(), "public/data/administrative-dong-20260701.geojson");
  boundary = JSON.parse(readFileSync(path, "utf8")) as BoundaryCollection;
});

/** 창원시청. */
const CHANGWON_HALL = { lat: 35.2278, lng: 128.6817 };
/** 진주시청. */
const JINJU_HALL = { lat: 35.1803, lng: 128.1087 };
/** 부산 시청 — 경남 밖이다. */
const BUSAN_HALL = { lat: 35.1798, lng: 129.0751 };
/** 남해 앞바다. 경남 시군 안이지만 육지 경계 밖이다. */
const OPEN_SEA = { lat: 34.5, lng: 128.2 };

describe("지점이 속한 행정동", () => {
  test("305개 동을 그대로 읽는다", () => {
    expect(boundary.features.length).toBe(305);
  });

  test.each([
    [CHANGWON_HALL, "창원시"],
    [JINJU_HALL, "진주시"],
  ])("시청 좌표는 그 시 안이다: %o", (point, city) => {
    const region = findContainingRegion(point, boundary);
    expect(region).not.toBeNull();
    expect(region?.name).toContain(city);
    expect(region?.code).toMatch(/^\d{10}$/);
  });

  test.each([
    ["부산시청", BUSAN_HALL],
    ["바다 한가운데", OPEN_SEA],
  ])("경남 경계 밖이면 null이다: %s", (_label, point) => {
    expect(findContainingRegion(point, boundary)).toBeNull();
  });

  test("한 지점이 두 동에 속하지 않는다", () => {
    // 겹쳐 세면 "이 지점은 A동이자 B동"이라는 답이 나온다.
    const hits = boundary.features.filter((feature) => pointInFeature(CHANGWON_HALL, feature));
    expect(hits.length).toBe(1);
  });
});

describe("구멍을 무시하지 않는다", () => {
  /*
   * 지금 경계 자료에는 구멍이 없다. 그래서 이 계약은 실제 자료로는 못 지킨다 —
   * 도넛을 직접 만들어 확인한다. 구멍 처리를 빠뜨리면 도넛 한가운데를 찍고도
   * "이 동 안"이라는 답이 나오고, 그것은 조용히 틀린 답이다.
   */
  const donut: BoundaryFeature = {
    type: "Feature",
    properties: { adm_cd2: "4800000000", adm_nm: "테스트 도넛동" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [128.0, 35.0],
          [128.1, 35.0],
          [128.1, 35.1],
          [128.0, 35.1],
          [128.0, 35.0],
        ],
        [
          [128.04, 35.04],
          [128.06, 35.04],
          [128.06, 35.06],
          [128.04, 35.06],
          [128.04, 35.04],
        ],
      ],
    },
  };

  test("고리 위는 안이다", () => {
    expect(pointInFeature({ lat: 35.02, lng: 128.02 }, donut)).toBe(true);
  });

  test("구멍 한가운데는 밖이다", () => {
    expect(pointInFeature({ lat: 35.05, lng: 128.05 }, donut)).toBe(false);
  });

  test("도넛 바깥은 밖이다", () => {
    expect(pointInFeature({ lat: 35.5, lng: 128.05 }, donut)).toBe(false);
  });
});

describe("반경 조회", () => {
  const facilities = [
    { id: "f1", name: "가까운의원", type: "의원", lat: 35.2280, lng: 128.6820 },
    { id: "f2", name: "1km병원", type: "병원", lat: 35.2368, lng: 128.6817 },
    { id: "f3", name: "5km약국", type: "약국", lat: 35.2728, lng: 128.6817 },
    { id: "f4", name: "또다른의원", type: "의원", lat: 35.2300, lng: 128.6850 },
  ];

  test("반경 안 시설만 세고 가까운 것부터 준다", () => {
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities });
    expect(probe.facilities.map((f) => f.id)).toEqual(["f1", "f4", "f2"]);
    const distances = probe.facilities.map((f) => f.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  test("종류별 개수는 많은 것부터", () => {
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities });
    expect(probe.byType).toEqual([
      { type: "의원", count: 2 },
      { type: "병원", count: 1 },
    ]);
  });

  test("최근접은 반경 밖이어도 알려 준다", () => {
    /*
     * 반경 안이 비었을 때 "없습니다"로 끝내면 5.1km에 병원이 있는 곳과 40km에 있는 곳이
     * 같은 답을 받는다. 그 둘은 전혀 다른 상황이다.
     */
    const far = probeRadius({
      point: CHANGWON_HALL,
      radiusKm: 1,
      boundary,
      facilities: [facilities[2]],
    });
    expect(far.facilities).toHaveLength(0);
    expect(far.nearest?.id).toBe("f3");
    expect(far.nearest?.distanceKm).toBeGreaterThan(1);
  });

  test("시설이 하나도 없으면 최근접도 없다", () => {
    const empty = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities: [] });
    expect(empty.nearest).toBeNull();
    expect(empty.facilities).toHaveLength(0);
  });

  test("반경이 0 이하면 던진다", () => {
    expect(() => probeRadius({ point: CHANGWON_HALL, radiusKm: 0, boundary, facilities })).toThrow(RangeError);
  });
});

describe("걸치는 행정동", () => {
  test("지점이 속한 동이 맨 앞이고 거리는 0이다", () => {
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities: [] });
    expect(probe.regions[0].contains).toBe(true);
    expect(probe.regions[0].distanceKm).toBe(0);
    expect(probe.regions[0].code).toBe(probe.containing?.code);
  });

  test("반경을 넓히면 걸치는 동이 늘기만 한다", () => {
    /*
     * 상자 걸러내기가 걸쳐야 할 동을 빠뜨리면 여기서 드러난다 — 반경을 넓혔는데
     * 목록이 줄거나 사라진 동이 있으면 걸러내기가 너무 세게 잘라낸 것이다.
     */
    const small = probeRadius({ point: CHANGWON_HALL, radiusKm: 1, boundary, facilities: [] });
    const large = probeRadius({ point: CHANGWON_HALL, radiusKm: 3, boundary, facilities: [] });
    expect(large.regions.length).toBeGreaterThan(small.regions.length);
    const largeCodes = new Set(large.regions.map((region) => region.code));
    for (const region of small.regions) expect(largeCodes.has(region.code)).toBe(true);
  });

  test("실제 경계로 센 개수가 상자 걸러내기와 어긋나지 않는다", () => {
    /*
     * 상자 걸러내기(bbox prefilter)는 빠르자고 넣은 것이라, 너무 세게 자르면 걸쳐야 할
     * 동을 조용히 빠뜨린다. 비율만 보는 검사는 그것을 못 잡는다 — 걸러내기를 3할로
     * 조여도 반경이 커지면 목록도 커지므로 단조성은 그대로 지켜진다(실측).
     *
     * 그래서 걸러내기 없이 9만 개 꼭짓점을 통째로 훑어 얻은 값을 그대로 못 박는다.
     * 창원시청 기준 1·2·3km에서 각각 5·8·10개다. 경계 자료를 새로 받아 이 값이
     * 달라지면 검사가 붉어지는 것이 맞다 — 그때는 새 자료로 다시 재야 한다.
     */
    for (const [radiusKm, expected] of [
      [1, 5],
      [2, 8],
      [3, 10],
    ] as const) {
      const probe = probeRadius({ point: CHANGWON_HALL, radiusKm, boundary, facilities: [] });
      expect({ radiusKm, count: probe.regions.length }).toEqual({ radiusKm, count: expected });
    }
  });

  test("걸치는 동은 모두 반경 안이다", () => {
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 3, boundary, facilities: [] });
    for (const region of probe.regions) expect(region.distanceKm).toBeLessThanOrEqual(3);
  });

  test("변까지 재지 꼭짓점까지 재지 않는다", () => {
    /*
     * 꼭짓점만 재면 긴 변이 지점 옆을 스쳐도 "안 걸친다"고 답한다. 꼭짓점이 양 끝에만
     * 있는 긴 사각형을 만들어, 지점에서 500m 떨어진 변을 잡아내는지 본다. 가장 가까운
     * 꼭짓점은 50km 넘게 떨어져 있다.
     */
    const slab: BoundaryCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { adm_cd2: "4899999999", adm_nm: "테스트 긴동" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [127.5, 35.2323],
                [129.5, 35.2323],
                [129.5, 35.3323],
                [127.5, 35.3323],
                [127.5, 35.2323],
              ],
            ],
          },
        },
      ],
    };
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 1, boundary: slab, facilities: [] });
    expect(probe.regions).toHaveLength(1);
    expect(probe.regions[0].distanceKm).toBeGreaterThan(0.3);
    expect(probe.regions[0].distanceKm).toBeLessThan(0.8);
  });
});

describe("합계를 지어내지 않는다", () => {
  test("반경 안 인구·소비 합계를 내지 않는다고 적는다", () => {
    /*
     * 이 도구가 낼 수 있는 가장 나쁜 답이 「반경 2km 안 생활인구 3만 8천 명」이다.
     * 원이 동을 자르면 면적 비례 배분을 가정해야 하고, 그 가정은 산이 절반인 읍에서
     * 사람을 산에 올려놓는다. 값을 내지 않는 것과 그 사실을 적는 것이 함께 계약이다.
     */
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities: [] });
    expect(probe.notes.some((note) => note.includes("합계는 내지 않습니다"))).toBe(true);
    expect(Object.keys(probe)).not.toContain("population");
  });

  test("직선거리임을 밝힌다", () => {
    const probe = probeRadius({ point: CHANGWON_HALL, radiusKm: 2, boundary, facilities: [] });
    expect(probe.notes.some((note) => note.includes("직선거리"))).toBe(true);
  });

  test("경계 밖이면 '자료 없음'이 아니라 '경계 밖'이라고 말한다", () => {
    const probe = probeRadius({ point: BUSAN_HALL, radiusKm: 2, boundary, facilities: [] });
    expect(probe.containing).toBeNull();
    expect(probe.notes.some((note) => note.includes("경계 밖"))).toBe(true);
  });
});
