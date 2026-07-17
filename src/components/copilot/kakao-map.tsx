"use client";

import { useEffect, useRef, useState } from "react";

import {
  loadKakaoSdk,
  type KakaoMapInstance,
  type KakaoMapsNamespace,
  type KakaoMarkerClusterer,
  type KakaoOverlay,
} from "./kakao-sdk";
import type { BoundaryCollection, Facility, Position, RegionSeries } from "./types";

type KakaoMapProps = {
  appKey: string;
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
  onError: (message: string) => void;
  onReady?: () => void;
};

const LEGEND_COLORS = ["#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"];

function scoreColor(score: number | undefined): string {
  if (score == null) return "#e8eef5";
  if (score >= 80) return "#1d4ed8";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#93c5fd";
  if (score >= 20) return "#dbeafe";
  return "#eff6ff";
}

export function KakaoMap({
  appKey,
  boundary,
  regions,
  facilities,
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
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const [context, setContext] = useState<{
    maps: KakaoMapsNamespace;
    map: KakaoMapInstance;
  } | null>(null);
  const [status, setStatus] = useState("Kakao 지도를 연결하는 중…");

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
          // Force tile layout after flex/grid size settles.
          window.setTimeout(() => map.relayout?.(), 0);
          window.setTimeout(() => map.relayout?.(), 200);
          setContext({ maps, map });
          setStatus("");
          onReady?.();
        })
        .catch((error: unknown) => {
          if (!active) return;
          const message =
            error instanceof Error ? error.message : "Kakao 지도를 불러오지 못했습니다.";
          setStatus(message);
          onError(message);
        });
    };

    const init = () => {
      if (!active) return;
      if (!containerRef.current) {
        attempts += 1;
        if (attempts > 40) {
          onError("지도 컨테이너를 준비하지 못했습니다.");
          return;
        }
        retryTimer = window.setTimeout(init, 50);
        return;
      }
      const el = containerRef.current;
      // Wait briefly for real layout; jsdom/tests have 0 size so cap retries low.
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
  }, [appKey, onError, onReady]);

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
    const { maps, map } = context;

    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    for (const marker of plainMarkersRef.current) marker.setMap(null);
    plainMarkersRef.current = [];
    clustererRef.current?.clear();
    clustererRef.current = null;

    const toPath = (ring: Position[]) => ring.map(([lng, lat]) => new maps.LatLng(lat, lng));

    // Limit polygon work for first paint reliability; still cover all features.
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
    }

    // Cap markers to keep map interactive; cluster when available.
    const markerFacilities = facilities.slice(0, 400);
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

      try {
        if (typeof maps.MarkerClusterer === "function") {
          const clusterer = new maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 6,
          });
          clusterer.addMarkers(markers);
          clustererRef.current = clusterer;
        } else {
          throw new Error("clusterer unavailable");
        }
      } catch {
        // Clusterer optional — plain markers still show Kakao basemap.
        for (const marker of markers) {
          marker.setMap(map);
          plainMarkersRef.current.push(marker);
        }
      }
    }

    map.relayout?.();

    return () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      overlaysRef.current = [];
      for (const marker of plainMarkersRef.current) marker.setMap(null);
      plainMarkersRef.current = [];
      clustererRef.current?.clear();
      clustererRef.current = null;
    };
  }, [
    boundary,
    context,
    facilities,
    onSelectFacility,
    onSelectRegion,
    radiusKm,
    regions,
    scores,
    selectedRegionCode,
  ]);

  return (
    <div
      className="relative size-full min-h-[320px] bg-[#dfe8ef]"
      data-facilities-mode={showFacilities ? "all" : "analysis"}
      data-map-engine="kakao"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 size-full"
        aria-label="Kakao 부산 행정동 분석 지도"
      />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
        Kakao Maps
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
