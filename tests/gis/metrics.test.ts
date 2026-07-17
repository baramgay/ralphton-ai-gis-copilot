import { describe, expect, test } from "vitest";

import {
  countFacilitiesWithinRadius,
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
