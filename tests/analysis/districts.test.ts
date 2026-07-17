import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPARE,
  districtFromAdmName,
  listDistricts,
  normalizeComparePair,
} from "@/lib/analysis/districts";

describe("districts", () => {
  it("extracts gu/gun from adm_nm", () => {
    expect(districtFromAdmName("부산광역시 해운대구 우동")).toBe("해운대구");
    expect(districtFromAdmName("부산광역시 기장군 기장읍")).toBe("기장군");
    expect(districtFromAdmName("중구 중앙동")).toBe("중구");
  });

  it("lists unique sorted districts", () => {
    const list = listDistricts([
      { adm_nm: "부산광역시 강서구 대저1동" },
      { adm_nm: "부산광역시 기장군 기장읍" },
      { adm_nm: "부산광역시 강서구 명지동" },
    ]);
    expect(list).toEqual(["강서구", "기장군"]);
  });

  it("normalizes compare pair without duplicates", () => {
    const available = ["중구", "해운대구", "기장군", "강서구"];
    expect(normalizeComparePair("기장군", "기장군", available)).toEqual(["기장군", "중구"]);
    expect(normalizeComparePair("없는구", "해운대구", available)[1]).toBe("해운대구");
    expect(normalizeComparePair("", "", [])).toEqual(DEFAULT_COMPARE);
  });
});
