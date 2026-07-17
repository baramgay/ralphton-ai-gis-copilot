"use client";

import { useEffect, useRef, useState } from "react";

import {
  ensureMarkerClusterer,
  loadKakaoSdk,
  type KakaoMapInstance,
  type KakaoMapsNamespace,
  type KakaoMarkerClusterer,
  type KakaoOverlay,
} from "./kakao-sdk";
import type { BoundaryCollection, Facility, Position, RegionSeries } from "./types";

export type LiveMapPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categoryName?: string;
  distanceMeters?: number | null;
};

type KakaoMapProps = {
  appKey: string;
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
  onError: (message: string) => void;
  onReady?: () => void;
};

const LEGEND_COLORS = ["#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"];
const PLAIN_MARKER_CAP = 80;
const CLUSTER_MARKER_CAP = 350;

function scoreColor(score: number | undefined): string {
  if (score == null) return "#e8eef5";
  if (score >= 80) return "#1d4ed8";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#93c5fd";
  if (score >= 20) return "#dbeafe";
  return "#eff6ff";
}

/** Prefer selected dong, then high analysis score regions. */
function prioritizeFacilities(
  facilities: Facility[],
  selectedRegionCode: string | null,
  scores: Map<string, number>,
  cap: number,
): Facility[] {
  if (facilities.length <= cap) return facilities;
  const ranked = [...facilities].sort((left, right) => {
    const leftSelected = left.adm_cd2 === selectedRegionCode ? 1 : 0;
    const rightSelected = right.adm_cd2 === selectedRegionCode ? 1 : 0;
    if (leftSelected !== rightSelected) return rightSelected - leftSelected;
    const leftScore = scores.get(left.adm_cd2) ?? -1;
    const rightScore = scores.get(right.adm_cd2) ?? -1;
    return rightScore - leftScore;
  });
  return ranked.slice(0, cap);
}

export function KakaoMap({
  appKey,
  boundary,
  regions,
  facilities,
  livePlaces = [],
  scores,
  selectedRegionCode,
  radiusKm,
  showFacilities,
  legendLabel = "상대 분석값",
  onSelectRegion,
  onSelectFacility,
  onError,
  onReady,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const plainMarkersRef = useRef<KakaoOverlay[]>([]);
  const liveMarkersRef = useRef<KakaoOverlay[]>([]);
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const [context, setContext] = useState<{
    maps: KakaoMapsNamespace;
    map: KakaoMapInstance;
    clustererReady: boolean;
  } | null>(null);
  const [status, setStatus] = useState("Kakao 지도를 연결하는 중…");

  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  onErrorRef.current = onError;
  onReadyRef.current = onReady;

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    let attempts = 0;

    const bootMap = () => {
      loadKakaoSdk(appKey)
        .then((maps) => {
          if (!active || !containerRef.current) return;
          const map = new maps.Map(containerRef.current, {
            center: new maps.LatLng(35.1796, 129.0756),
            level: 8,
          });
          window.setTimeout(() => map.relayout?.(), 0);
          window.setTimeout(() => map.relayout?.(), 200);
          // Map first — clusterer is optional 2nd stage (must not block paint/tests).
          setContext({ maps, map, clustererReady: false });
          setStatus("");
          onReadyRef.current?.();
          void ensureMarkerClusterer().then((clustererReady) => {
            if (!active || !clustererReady) return;
            setContext((previous) =>
              previous ? { ...previous, clustererReady: true } : previous,
            );
          });
        })
        .catch((error: unknown) => {
          if (!active) return;
          const message =
            error instanceof Error ? error.message : "Kakao 지도를 불러오지 못했습니다.";
          setStatus(message);
          onErrorRef.current(message);
        });
    };

    const init = () => {
      if (!active) return;
      if (!containerRef.current) {
        attempts += 1;
        if (attempts > 40) {
          onErrorRef.current("지도 컨테이너를 준비하지 못했습니다.");
          return;
        }
        retryTimer = window.setTimeout(init, 50);
        return;
      }
      const el = containerRef.current;
      if ((el.clientWidth < 8 || el.clientHeight < 8) && attempts < 2) {
        attempts += 1;
        retryTimer = window.setTimeout(init, 16);
        return;
      }
      bootMap();
    };

    init();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [appKey]);

  useEffect(() => {
    if (!context || !containerRef.current) return;
    const { map } = context;
    if (typeof ResizeObserver === "undefined") {
      map.relayout?.();
      return;
    }
    const observer = new ResizeObserver(() => {
      map.relayout?.();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [context]);

  useEffect(() => {
    if (!context) return;
    const { maps, map, clustererReady } = context;

    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    for (const marker of plainMarkersRef.current) marker.setMap(null);
    plainMarkersRef.current = [];
    for (const marker of liveMarkersRef.current) marker.setMap(null);
    liveMarkersRef.current = [];
    clustererRef.current?.clear();
    clustererRef.current = null;

    const toPath = (ring: Position[]) => ring.map(([lng, lat]) => new maps.LatLng(lat, lng));

    for (const feature of boundary.features) {
      const polygons =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const polygonCoordinates of polygons) {
        const polygon = new maps.Polygon({
          path: polygonCoordinates.map(toPath),
          strokeWeight: feature.properties.adm_cd2 === selectedRegionCode ? 3 : 1,
          strokeColor: feature.properties.adm_cd2 === selectedRegionCode ? "#172554" : "#ffffff",
          strokeOpacity: 0.9,
          fillColor: scoreColor(scores.get(feature.properties.adm_cd2)),
          fillOpacity: 0.72,
        });
        polygon.setMap(map);
        maps.event.addListener(polygon, "click", () => onSelectRegion(feature.properties.adm_cd2));
        overlaysRef.current.push(polygon);
      }
    }

    const selected = regions.find((region) => region.adm_cd2 === selectedRegionCode);
    if (selected) {
      const circle = new maps.Circle({
        center: new maps.LatLng(
          selected.representativePoint.lat,
          selected.representativePoint.lng,
        ),
        radius: radiusKm * 1000,
        strokeWeight: 2,
        strokeColor: "#2563eb",
        strokeOpacity: 0.85,
        strokeStyle: "dash",
        fillColor: "#3b82f6",
        fillOpacity: 0.1,
      });
      circle.setMap(map);
      overlaysRef.current.push(circle);
      map.setCenter(
        new maps.LatLng(selected.representativePoint.lat, selected.representativePoint.lng),
      );
      map.setLevel?.(6);
    }

    const useCluster =
      clustererReady && typeof maps.MarkerClusterer === "function";
    const cap = useCluster ? CLUSTER_MARKER_CAP : PLAIN_MARKER_CAP;
    const markerFacilities = prioritizeFacilities(
      facilities,
      selectedRegionCode,
      scores,
      cap,
    );

    if (markerFacilities.length > 0) {
      const markers = markerFacilities.map((facility) => {
        const marker = new maps.Marker({
          position: new maps.LatLng(facility.lat, facility.lng),
          title: `${facility.name} · ${facility.type}`,
        });
        if (onSelectFacility) {
          maps.event.addListener(marker, "click", () => onSelectFacility(facility));
        }
        return marker;
      });

      if (useCluster) {
        try {
          const clusterer = new maps.MarkerClusterer!({
            map,
            averageCenter: true,
            minLevel: 6,
          });
          clusterer.addMarkers(markers);
          clustererRef.current = clusterer;
        } catch {
          for (const marker of markers) {
            marker.setMap(map);
            plainMarkersRef.current.push(marker);
          }
        }
      } else {
        for (const marker of markers) {
          marker.setMap(map);
          plainMarkersRef.current.push(marker);
        }
      }
    }

    // Kakao REST live places — separate layer (not clustered)
    for (const place of livePlaces.slice(0, 20)) {
      const marker = new maps.Marker({
        position: new maps.LatLng(place.lat, place.lng),
        title: `실시간 · ${place.name}`,
      });
      marker.setMap(map);
      liveMarkersRef.current.push(marker);
    }

    map.relayout?.();

    return () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      overlaysRef.current = [];
      for (const marker of plainMarkersRef.current) marker.setMap(null);
      plainMarkersRef.current = [];
      for (const marker of liveMarkersRef.current) marker.setMap(null);
      liveMarkersRef.current = [];
      clustererRef.current?.clear();
      clustererRef.current = null;
    };
  }, [
    boundary,
    context,
    facilities,
    livePlaces,
    onSelectFacility,
    onSelectRegion,
    radiusKm,
    regions,
    scores,
    selectedRegionCode,
    showFacilities,
  ]);

  return (
    <div
      className="relative size-full min-h-[320px] bg-[#dfe8ef]"
      data-facilities-mode={showFacilities ? "all" : "analysis"}
      data-map-engine="kakao"
      data-clusterer={context?.clustererReady ? "on" : "off"}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 size-full"
        aria-label="Kakao 부산 행정동 분석 지도"
      />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
        Kakao Maps
        {context?.clustererReady ? " · 클러스터" : ""}
      </div>
      {status ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100/50">
          <p className="max-w-sm rounded-2xl bg-white px-4 py-3 text-center text-xs font-semibold leading-5 text-slate-600 shadow">
            {status}
          </p>
        </div>
      ) : null}
      <div className="absolute bottom-5 right-4 w-44 rounded-2xl border border-white/80 bg-white/92 p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span>{legendLabel}</span>
          <span>높음</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {LEGEND_COLORS.map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
      </div>
    </div>
  );
}
