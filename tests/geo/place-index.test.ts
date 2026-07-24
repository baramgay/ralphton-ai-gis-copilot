import { describe, expect, test } from "vitest";

import {
  findPlaceByCode,
  findPlacesByDistrict,
  getAllPlaces,
  matchPlacesInText,
} from "@/lib/geo/place-index";
import { parseIntentWithRules } from "@/lib/analysis/query-rules";
import { extractQuerySignals } from "@/lib/analysis/query-signals";

describe("place-index gazetteer", () => {
  test("has gyeongnam dongs", () => {
    const places = getAllPlaces();
    expect(places.length).toBe(305);
    expect(places.every((p) => p.adm_nm.startsWith("경상남도"))).toBe(true);
  });

  test("matches 상대동", () => {
    const hits = matchPlacesInText("상대동 병원 어때");
    expect(hits.some((hit) => hit.shortName === "상대동")).toBe(true);
    expect(hits[0]?.district).toBe("진주시");
  });

  test("find by code", () => {
    const place = findPlaceByCode("4817056500");
    expect(place?.shortName).toBe("중앙동");
  });

  test("district listing", () => {
    const list = findPlacesByDistrict("진주시");
    expect(list.length).toBeGreaterThan(3);
  });
});

describe("dong in NL signals/rules", () => {
  test("signals capture dong codes", () => {
    const signals = extractQuerySignals("중앙동 상세");
    expect(signals.dongs.length).toBeGreaterThan(0);
    expect(signals.dongs[0]?.adm_cd2).toMatch(/^\d{10}$/);
  });

  test("rules resolve dong query to getRegionDetails", () => {
    const intent = parseIntentWithRules("상대동 현황");
    expect(intent?.tool).toBe("getRegionDetails");
    expect(intent?.filters.regions?.[0]).toMatch(/^\d{10}$/);
  });
});
