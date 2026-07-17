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
  radiusKm: 1 | 2 | 3;
  showFacilities: boolean;
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
  const { kakaoMapKey, onEngineChange, livePlaces, onSelectLivePlace, ...mapProps } = props;

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
          <p className="text-[11px] font-bold text-amber-900">Kakao 지도 연결 실패 · DemoMap 표시 중</p>
          <p className="mt-1 text-[10px] leading-5 text-amber-800">
            {errorMessage ??
              "앱 키·웹 도메인(localhost / vercel.app)·CSP를 확인하세요."}
          </p>
          <button
            type="button"
            className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-amber-800 active:scale-[0.98]"
            onClick={retryKakao}
          >
            Kakao 지도 다시 시도
          </button>
        </div>
      ) : (
        <div className="absolute left-4 top-14 z-20 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-600 shadow">
          NEXT_PUBLIC_KAKAO_MAP_KEY 없음 · DemoMap
        </div>
      )}
    </div>
  );
}
