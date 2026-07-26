import { describe, expect, test } from "vitest";

import { distance as turfDistance } from "@turf/distance";
import { point as turfPoint } from "@turf/helpers";

import {
  countFacilitiesWithinRadius,
  facilityAccessSummary,
  medicalVulnerabilityIndex,
  nearestFacilityDistance,
  winsorizedMinMax,
} from "@/lib/gis/metrics";

const origin = { lat: 35.1796, lng: 129.0756 };

describe("nearestFacilityDistance", () => {
  test("uses geodesic kilometers", () => {
    const oneKilometerNorth = { lat: 35.188593, lng: 129.0756 };

    expect(nearestFacilityDistance(origin, [oneKilometerNorth])).toBeCloseTo(1, 1);
  });

  test("preserves missing data when there are no facilities", () => {
    expect(nearestFacilityDistance(origin, [])).toBeNull();
  });
});

describe("countFacilitiesWithinRadius", () => {
  test("counts only facilities in the requested radius", () => {
    const facilities = [
      origin,
      { lat: 35.188593, lng: 129.0756 },
      { lat: 35.206579, lng: 129.0756 },
    ];

    expect(countFacilitiesWithinRadius(origin, facilities, 2)).toBe(2);
  });
});

describe("winsorizedMinMax", () => {
  test("normalizes finite values to 0-100 and preserves null", () => {
    expect(winsorizedMinMax([0, null, 10])).toEqual([0, null, 100]);
  });

  test("can score lower raw values as more vulnerable", () => {
    expect(winsorizedMinMax([0, 10], "lower-is-higher-risk")).toEqual([100, 0]);
  });
});

describe("medicalVulnerabilityIndex", () => {
  test("applies the documented 35/25/25/15 weights", () => {
    expect(
      medicalVulnerabilityIndex({
        supplyScarcityScore: 100,
        elderlyDemandScore: 60,
        nearestDistanceScore: 40,
        noFacilityWithin2KmScore: 100,
      }),
    ).toBe(75);
  });

  test("stays within 0-100", () => {
    const score = medicalVulnerabilityIndex({
      supplyScarcityScore: 200,
      elderlyDemandScore: -20,
      nearestDistanceScore: 200,
      noFacilityWithin2KmScore: 100,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test("does not invent a composite when a component is missing", () => {
    expect(
      medicalVulnerabilityIndex({
        supplyScarcityScore: 100,
        elderlyDemandScore: 60,
        nearestDistanceScore: null,
        noFacilityWithin2KmScore: 100,
      }),
    ).toBeNull();
  });
});

describe("거리 계산을 turf 없이 해도 값이 같은가", () => {
  // turf 객체 할당을 없애려고 하버사인을 직접 넣었다. 성능 때문에 수치가 달라지면
  // 의료취약지수 순위가 조용히 바뀌므로, 원본과의 일치를 여기서 잠근다.
  test("경남 좌표 범위 전역에서 @turf/distance와 일치한다", () => {
    // 경남 대략 경계: 위도 34.5~35.9, 경도 127.5~129.3
    let seed = 20260726;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    let worst = 0;
    for (let i = 0; i < 2000; i += 1) {
      const a = { lat: 34.5 + rand() * 1.4, lng: 127.5 + rand() * 1.8 };
      const b = { lat: 34.5 + rand() * 1.4, lng: 127.5 + rand() * 1.8 };
      const mine = nearestFacilityDistance(a, [b]) ?? 0;
      const theirs = turfDistance(turfPoint([a.lng, a.lat]), turfPoint([b.lng, b.lat]), {
        units: "kilometers",
      });
      worst = Math.max(worst, Math.abs(mine - theirs));
    }
    // 같은 수식·같은 지구반지름이므로 부동소수점 오차만 남아야 한다.
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("facilityAccessSummary", () => {
  const facilities = [
    { lat: 35.1796, lng: 129.0756 },
    { lat: 35.188593, lng: 129.0756 },
    { lat: 35.25, lng: 129.2 },
    { lat: 34.9, lng: 128.6 },
  ];

  test("따로 부른 두 함수와 같은 값을 낸다", () => {
    const from = { lat: 35.17, lng: 129.05 };
    for (const radiusKm of [0, 1, 2, 5, 50]) {
      const summary = facilityAccessSummary(from, facilities, radiusKm);
      expect(summary.nearestKm).toBe(nearestFacilityDistance(from, facilities));
      expect(summary.withinRadius).toBe(countFacilitiesWithinRadius(from, facilities, radiusKm));
    }
  });

  test("시설이 없으면 최근접 거리를 지어내지 않는다", () => {
    const summary = facilityAccessSummary({ lat: 35, lng: 128 }, [], 2);
    expect(summary.nearestKm).toBeNull();
    expect(summary.withinRadius).toBe(0);
  });

  test("반경이 음수면 거부한다", () => {
    expect(() => facilityAccessSummary({ lat: 35, lng: 128 }, facilities, -1)).toThrow(RangeError);
  });
});
