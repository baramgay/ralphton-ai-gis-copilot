import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPARE,
  districtFromAdmName,
  listDistricts,
  listDongLabels,
  normalizeComparePair,
} from "@/lib/analysis/districts";

describe("districts", () => {
  it("extracts gu/gun from adm_nm", () => {
    expect(districtFromAdmName("경상남도 창원시 의창구 용지동")).toBe("창원시");
    expect(districtFromAdmName("경상남도 김해시 내외동")).toBe("김해시");
    expect(districtFromAdmName("경상남도 진주시 천전동")).toBe("진주시");
    expect(districtFromAdmName("중구 중앙동")).toBe("중구");
  });

  it("lists unique sorted districts", () => {
    const list = listDistricts([
      { adm_nm: "경상남도 창원시 의창구 동읍" },
      { adm_nm: "경상남도 김해시 내외동" },
      { adm_nm: "경상남도 창원시 의창구 대산면" },
    ]);
    expect(list).toEqual(["김해시", "창원시"]);
  });

  it("normalizes compare pair without duplicates", () => {
    const available = ["진주시", "창원시", "김해시", "통영시"];
    expect(normalizeComparePair("김해시", "김해시", available)).toEqual(["김해시", "진주시"]);
    expect(normalizeComparePair("없는시", "창원시", available)[1]).toBe("창원시");
    expect(normalizeComparePair("", "", [])).toEqual(DEFAULT_COMPARE);
  });

  it("lists dong labels for pairwise compare", () => {
    const labels = listDongLabels([
      { adm_nm: "경상남도 진주시 천전동", adm_cd2: "4817051000" },
      { adm_nm: "경상남도 창원시 의창구 동읍", adm_cd2: "4812051000" },
    ]);
    expect(labels).toEqual(["진주시 천전동", "창원시 의창구 동읍"]);
  });
});
