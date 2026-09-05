"use client";

import { useCallback, useEffect, useState } from "react";

import { DemoMap } from "./demo-map";
import { KakaoMap, type LiveMapPlace } from "./kakao-map";
import { resetKakaoSdkCache } from "./kakao-sdk";
import type { BoundaryCollection, Facility, RegionSeries } from "./types";

type MapCanvasProps = {
  kakaoMapKey: string;
  boundary: BoundaryCollection;
  regions: RegionSeries[];
  facilities: Facility[];
  livePlaces?: LiveMapPlace[];
  scores: Map<string, number>;
  selectedRegionCode: string | null;
  focusRegionCodes?: Set<string> | null;
  radiusKm: 1 | 2 | 3;
  showFacilities: boolean;
  /** 선택 지역을 지도가 따라갈지. 사용자가 직접 고른 선택에만 켠다. */
  followSelection?: boolean;
  /** 반경 원 표시 여부. 의료 접근성 분석에서만 뜻이 있다. */
  showRadius?: boolean;
  /** 지점 찍기 모드. Kakao 지도에서만 뜻이 있다(DemoMap은 좌표 클릭을 받지 못한다). */
  probeMode?: boolean;
  probePoint?: { lat: number; lng: number } | null;
  probeRadiusKm?: number;
  onProbePoint?: (point: { lat: number; lng: number }) => void;
  legendLabel?: string;
  onSelectRegion: (code: string) => void;
  onSelectFacility?: (facility: Facility) => void;
  onSelectLivePlace?: (place: LiveMapPlace) => void;
  onEngineChange?: (engine: "kakao" | "demo") => void;
};

export function MapCanvas(props: MapCanvasProps) {
  const [kakaoFailed, setKakaoFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  // DemoMap은 Kakao 전용 카메라 제어 속성을 받지 않는다. 여기서 갈라 둔다.
  const {
    kakaoMapKey,
    onEngineChange,
    livePlaces,
    onSelectLivePlace,
    followSelection,
    showRadius,
    probeMode,
    probePoint,
    probeRadiusKm,
    onProbePoint,
    ...mapProps
  } = props;

  const handleError = useCallback(
    (message: string) => {
      setErrorMessage(message);
      setKakaoFailed(true);
      onEngineChange?.("demo");
    },
    [onEngineChange],
  );

  const handleReady = useCallback(() => {
    setErrorMessage(null);
    setKakaoFailed(false);
    onEngineChange?.("kakao");
  }, [onEngineChange]);

  useEffect(() => {
    if (kakaoMapKey && !kakaoFailed) onEngineChange?.("kakao");
    else onEngineChange?.("demo");
  }, [kakaoFailed, kakaoMapKey, onEngineChange]);

  const retryKakao = () => {
    resetKakaoSdkCache();
    setErrorMessage(null);
    setKakaoFailed(false);
    setRetryToken((value) => value + 1);
  };

  if (kakaoMapKey && !kakaoFailed) {
    return (
      <KakaoMap
        key={`kakao-${retryToken}`}
        appKey={kakaoMapKey}
        {...mapProps}
        livePlaces={livePlaces}
        onSelectLivePlace={onSelectLivePlace}
        followSelection={followSelection}
        showRadius={showRadius}
        probeMode={probeMode}
        probePoint={probePoint}
        probeRadiusKm={probeRadiusKm}
        onProbePoint={onProbePoint}
        onError={handleError}
        onReady={handleReady}
      />
    );
  }

  return (
    <div className="relative size-full">
      <DemoMap {...mapProps} />
      {kakaoMapKey ? (
        <div className="absolute left-4 top-14 z-20 max-w-sm rounded-2xl border border-amber-200 bg-amber-50/95 p-3 shadow-lg">
          <p className="text-[11px] font-bold text-amber-900">지도를 불러오지 못했습니다 · 임시 지도로 표시 중</p>
          <p className="mt-1 text-[10px] leading-5 text-amber-800">
            {errorMessage ??
              "지도 서비스 연결에 문제가 있습니다. 잠시 뒤 다시 시도해 주세요."}
          </p>
          <button
            type="button"
            className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-amber-800 active:scale-[0.98]"
            onClick={retryKakao}
          >
            지도 다시 불러오기
          </button>
        </div>
      ) : (
        <div className="absolute left-4 top-14 z-20 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-600 shadow">
          지도 서비스가 연결되지 않아 임시 지도로 표시합니다
        </div>
      )}
    </div>
  );
}
