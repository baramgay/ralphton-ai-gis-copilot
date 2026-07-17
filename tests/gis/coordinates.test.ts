import { describe, expect, test } from "vitest";

import { geoJsonToKakaoPath } from "@/lib/gis/coordinates";

describe("geoJsonToKakaoPath", () => {
  test("swaps a GeoJSON longitude-latitude position into a Kakao point", () => {
    expect(geoJsonToKakaoPath([129.0756, 35.1796])).toEqual({
      lat: 35.1796,
      lng: 129.0756,
    });
  });

  test("preserves the nesting of polygon and multipolygon paths", () => {
    expect(
      geoJsonToKakaoPath([
        [
          [129.0, 35.0],
          [129.1, 35.1],
        ],
      ]),
    ).toEqual([
      [
        { lat: 35.0, lng: 129.0 },
        { lat: 35.1, lng: 129.1 },
      ],
    ]);
  });
});
