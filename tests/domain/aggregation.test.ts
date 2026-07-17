import { describe, expect, test } from "vitest";

import { aggregateTongBanRows, calculateNaturalChange } from "@/lib/domain/aggregation";

describe("aggregateTongBanRows", () => {
  const rowA = {
    adm_cd2: "2611051000",
    month: "2026-06",
    tong: "101",
    ban: "1",
    population: 100,
    households: 40,
  };

  const rowB = {
    adm_cd2: "2611051000",
    month: "2026-06",
    tong: "102",
    ban: "1",
    population: 200,
    households: 80,
  };

  test("deduplicates identical 통/반 rows and sums population", () => {
    const result = aggregateTongBanRows([rowA, rowA, rowB]);

    expect(result.population).toBe(rowA.population + rowB.population);
  });

  test("sums all provided numeric fields", () => {
    const result = aggregateTongBanRows([rowA, rowB]);

    expect(result.households).toBe(rowA.households + rowB.households);
  });

  test("last duplicate wins before summation", () => {
    const rowA1 = { ...rowA, population: 100 };
    const rowA2 = { ...rowA, population: 150 };

    const result = aggregateTongBanRows([rowA1, rowA2, rowB]);

    expect(result.population).toBe(150 + 200);
  });

  test("preserves null onePersonHouseholds when all values are null", () => {
    const result = aggregateTongBanRows([
      { ...rowA, onePersonHouseholds: null },
      { ...rowB, onePersonHouseholds: null },
    ]);

    expect(result.onePersonHouseholds).toBeNull();
  });

  test("sums numeric onePersonHouseholds while ignoring nulls", () => {
    const result = aggregateTongBanRows([
      { ...rowA, onePersonHouseholds: 10 },
      { ...rowB, onePersonHouseholds: null },
    ]);

    expect(result.onePersonHouseholds).toBe(10);
  });

  test("treats missing optional numeric fields as zero", () => {
    const result = aggregateTongBanRows([rowA, rowB]);

    expect(result.births).toBe(0);
    expect(result.deaths).toBe(0);
  });
});

describe("calculateNaturalChange", () => {
  test("returns births minus deaths", () => {
    expect(calculateNaturalChange({ births: 10, deaths: 3 })).toBe(7);
  });

  test("handles negative natural change", () => {
    expect(calculateNaturalChange({ births: 2, deaths: 8 })).toBe(-6);
  });
});
