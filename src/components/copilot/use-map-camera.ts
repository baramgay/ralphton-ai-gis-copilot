"use client";

import { useEffect, useRef } from "react";

import type { KakaoMapInstance, KakaoMapsNamespace } from "./kakao-sdk";
import type { BoundaryCollection } from "./types";

type MapContext = {
  maps: Pick<KakaoMapsNamespace, "LatLng" | "LatLngBounds">;
  map: KakaoMapInstance;
};

export function useMapCamera(context: MapContext | null, boundary: BoundaryCollection, paddingLeft = 0, paddingRight = 0, paddingTop = 0) {
  const fittedRef = useRef<{ map: KakaoMapInstance; extent: string } | null>(null);

  useEffect(() => {
    if (!context) return;
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    const walk = (coordinates: unknown): void => {
      if (typeof (coordinates as number[])[0] === "number") {
        const [lng, lat] = coordinates as number[];
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        return;
      }
      for (const part of coordinates as unknown[]) walk(part);
    };
    for (const feature of boundary.features) walk(feature.geometry.coordinates);
    if (!Number.isFinite(minLat)) return;

    const { maps, map } = context;
    const extent = `${minLat}:${minLng}:${maxLat}:${maxLng}:${paddingLeft}:${paddingRight}:${paddingTop}`;
    // 지표나 색이 바뀌어도 범위와 상단바·패널 크기가 같으면 수동 카메라를 유지한다.
    if (fittedRef.current?.map === map && fittedRef.current.extent === extent) return;
    if (maps.LatLngBounds && map.setBounds) {
      const bounds = new maps.LatLngBounds();
      bounds.extend(new maps.LatLng(minLat, minLng));
      bounds.extend(new maps.LatLng(maxLat, maxLng));
      if (paddingLeft || paddingRight || paddingTop) map.setBounds(bounds, paddingTop + 32, paddingRight + 32, 32, paddingLeft + 32);
      else map.setBounds(bounds);
    } else {
      map.setCenter(new maps.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2));
      map.setLevel?.(11);
    }
    fittedRef.current = { map, extent };
  }, [boundary, context, paddingLeft, paddingRight, paddingTop]);
}
