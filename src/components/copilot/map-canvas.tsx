"use client";

import { useCallback, useState } from "react";

import { DemoMap } from "./demo-map";
import { KakaoMap } from "./kakao-map";
import type { BoundaryCollection, Facility, RegionSeries } from "./types";

type MapCanvasProps = {
  kakaoMapKey: string;
  boundary: BoundaryCollection;
  regions: RegionSeries[];
  facilities: Facility[];
  scores: Map<string, number>;
  selectedRegionCode: string | null;
  radiusKm: 1 | 2 | 3;
  showFacilities: boolean;
  legendLabel?: string;
  onSelectRegion: (code: string) => void;
  onSelectFacility?: (facility: Facility) => void;
};

export function MapCanvas(props: MapCanvasProps) {
  const [kakaoFailed, setKakaoFailed] = useState(false);
  const handleError = useCallback(() => setKakaoFailed(true), []);
  const { kakaoMapKey, ...mapProps } = props;

  if (kakaoMapKey && !kakaoFailed) {
    return <KakaoMap appKey={kakaoMapKey} {...mapProps} onError={handleError} />;
  }

  return <DemoMap {...mapProps} />;
}
