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
  test("has 206 busan dongs", () => {
    expect(getAllPlaces().length).toBe(206);
  });

  test("matches 송정동", () => {
    const hits = matchPlacesInText("송정동 병원 어때");
    expect(hits.some((hit) => hit.shortName === "송정동")).toBe(true);
    expect(hits[0]?.district).toBe("해운대구");
  });

  test("find by code", () => {
    const place = findPlaceByCode("2611051000");
    expect(place?.shortName).toBe("중앙동");
  });

  test("district listing", () => {
    const list = findPlacesByDistrict("중구");
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
    const intent = parseIntentWithRules("송정동 현황");
    expect(intent?.tool).toBe("getRegionDetails");
    expect(intent?.filters.regions?.[0]).toMatch(/^\d{10}$/);
  });
});
