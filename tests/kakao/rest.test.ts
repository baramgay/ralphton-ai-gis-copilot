import { describe, expect, it, vi } from "vitest";

import {
  searchPlacesByCategory,
  searchPlacesByKeyword,
} from "@/lib/kakao/rest";

describe("kakao rest adapters", () => {
  it("maps keyword search documents", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        documents: [
          {
            id: "1",
            place_name: "창원중앙의원",
            category_name: "의료,건강 > 병원",
            category_group_code: "HP8",
            phone: "055-000-0000",
            address_name: "경남 창원시",
            road_address_name: "경남 창원시 중앙대로 1",
            y: "35.1",
            x: "129.04",
            distance: "120",
            place_url: "https://place.map.kakao.com/1",
          },
        ],
      }),
    }));

    const places = await searchPlacesByKeyword(
      { query: "병원", lat: 35.1, lng: 129.04 },
      { apiKey: "fixture", fetch: fetch as unknown as typeof globalThis.fetch },
    );

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      id: "1",
      name: "창원중앙의원",
      lat: 35.1,
      lng: 129.04,
      distanceMeters: 120,
    });
    expect(fetch).toHaveBeenCalled();
  });

  it("maps category search documents", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        documents: [
          {
            id: "p1",
            place_name: "중앙약국",
            category_group_code: "PM9",
            y: "35.11",
            x: "129.05",
          },
        ],
      }),
    }));

    const places = await searchPlacesByCategory(
      { categoryGroupCode: "PM9", lat: 35.1, lng: 129.04 },
      { apiKey: "fixture", fetch: fetch as unknown as typeof globalThis.fetch },
    );

    expect(places[0]?.name).toBe("중앙약국");
  });
});
