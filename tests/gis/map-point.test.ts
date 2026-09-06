import { describe, expect, test } from "vitest";

import type { Facility } from "@/lib/domain/schemas";
import { pointKindColor } from "@/lib/gis/facility-style";
import {
  MAP_POINT_CAP,
  capMapPoints,
  facilityToMapPoint,
  mapPointCapNotice,
} from "@/lib/gis/map-point";

const clinic: Facility = {
  id: "f1",
  name: "중앙의원",
  type: "의원",
  adm_cd2: "4812125000",
  adm_nm: "경상남도 창원시 의창구 동읍",
  lat: 35.1,
  lng: 129.04,
  specialties: ["내과"],
  hours: null,
};

describe("map-point", () => {
  test("의료기관을 자료 종류에 중립인 점으로 바꾼다", () => {
    expect(facilityToMapPoint(clinic)).toEqual({
      id: "f1",
      name: "중앙의원",
      lat: 35.1,
      lng: 129.04,
      kind: "의원",
      adm_cd2: "4812125000",
    });
  });

  test("상한을 넘기면 자르고 전체 수를 남긴다", () => {
    const items = Array.from({ length: 1_361 }, (_, index) => ({ id: String(index) }));
    const capped = capMapPoints(items, MAP_POINT_CAP);
    expect(capped.shown).toHaveLength(900);
    expect(capped.total).toBe(1_361);
    expect(capped.capped).toBe(true);
  });

  test("잘랐으면 화면에 쓸 문구를 만든다", () => {
    expect(mapPointCapNotice(900, 1_361)).toBe("지도 시설 900개 표시 · 전체 1,361");
    expect(mapPointCapNotice(22, 22)).toBeNull();
  });

  test("모르는 지점 종류는 기본색이다", () => {
    expect(pointKindColor("대피소")).toBe("#64748b");
    expect(pointKindColor("약국")).toBe("#ea580c");
  });
});
