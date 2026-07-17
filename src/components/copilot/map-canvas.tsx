"use client";

import { useCallback, useEffect, useState } from "react";

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
  onEngineChange?: (engine: "kakao" | "demo") => void;
};

export function MapCanvas(props: MapCanvasProps) {
  const [kakaoFailed, setKakaoFailed] = useState(false);
  const { kakaoMapKey, onEngineChange, ...mapProps } = props;

  const handleError = useCallback(() => {
    setKakaoFailed(true);
    onEngineChange?.("demo");
  }, [onEngineChange]);

  useEffect(() => {
    if (kakaoMapKey && !kakaoFailed) onEngineChange?.("kakao");
    else onEngineChange?.("demo");
  }, [kakaoFailed, kakaoMapKey, onEngineChange]);

  if (kakaoMapKey && !kakaoFailed) {
    return <KakaoMap appKey={kakaoMapKey} {...mapProps} onError={handleError} />;
  }

  return <DemoMap {...mapProps} />;
}
