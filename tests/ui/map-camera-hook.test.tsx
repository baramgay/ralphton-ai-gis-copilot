import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useMapCamera } from "@/components/copilot/use-map-camera";
import type { BoundaryCollection } from "@/components/copilot/types";
import type { KakaoLatLngBounds } from "@/components/copilot/kakao-sdk";

function boundary(minLng: number, maxLng: number): BoundaryCollection {
  return { type: "FeatureCollection", features: [{
    type: "Feature", properties: { adm_cd2: "48330", adm_nm: "양산시" },
    geometry: { type: "Polygon", coordinates: [[[minLng, 35], [maxLng, 35], [maxLng, 36], [minLng, 35]]] },
  }] };
}

function context() {
  return {
    maps: {
      LatLng: class { constructor(public lat: number, public lng: number) {} },
      LatLngBounds: class { points: object[] = []; extend(point: object) { this.points.push(point); } },
    },
    map: { setCenter: vi.fn(), setBounds: vi.fn<(bounds: KakaoLatLngBounds, top?: number, right?: number, bottom?: number, left?: number) => void>() },
  };
}

describe("map scope camera", () => {
  test("fits between sidebars, preserves unchanged padding, and refits resized or collapsed panels", () => {
    const engine = context();
    const area = boundary(128.8, 129.2);
    const { rerender } = renderHook(({ left, right }) => useMapCamera(engine, area, left, right), {
      initialProps: { left: 342, right: 398 },
    });
    expect(engine.map.setBounds.mock.calls[0].slice(1)).toEqual([32, 430, 32, 374]);
    rerender({ left: 342, right: 398 });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(1);
    rerender({ left: 366, right: 398 });
    expect(engine.map.setBounds.mock.calls[1].slice(1)).toEqual([32, 430, 32, 398]);
    rerender({ left: 0, right: 0 });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(3);
    expect(engine.map.setBounds.mock.calls[2]).toHaveLength(1);
  });
  test("fits changed geometry even when feature count and first code match, and restores full extent", () => {
    const engine = context();
    const full = boundary(127, 130);
    const { rerender } = renderHook(({ area }) => useMapCamera(engine, area), { initialProps: { area: full } });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(1);
    rerender({ area: boundary(128.8, 129.2) });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(2);
    expect((engine.map.setBounds.mock.calls[1][0] as InstanceType<typeof engine.maps.LatLngBounds>).points).toEqual([{ lat: 35, lng: 128.8 }, { lat: 36, lng: 129.2 }]);
    rerender({ area: full });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(3);
  });

  test("preserves manual camera position across equivalent scope and engine readiness updates", () => {
    const engine = context();
    const { rerender } = renderHook(({ engine, area }) => useMapCamera(engine, area), { initialProps: { engine, area: boundary(128.8, 129.2) } });
    rerender({ engine: { ...engine }, area: boundary(128.8, 129.2) });
    expect(engine.map.setBounds).toHaveBeenCalledTimes(1);
    const replacement = context();
    rerender({ engine: replacement, area: boundary(128.8, 129.2) });
    expect(replacement.map.setBounds).toHaveBeenCalledTimes(1);
  });
});
