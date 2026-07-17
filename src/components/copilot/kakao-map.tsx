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
  onError: () => void;
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
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const [context, setContext] = useState<{
    maps: KakaoMapsNamespace;
    map: KakaoMapInstance;
  } | null>(null);

  useEffect(() => {
    let active = true;
    loadKakaoSdk(appKey)
      .then((maps) => {
        if (!active || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(35.1796, 129.0756),
          level: 8,
        });
        setContext({ maps, map });
      })
      .catch(() => {
        if (active) onError();
      });
    return () => {
      active = false;
    };
  }, [appKey, onError]);

  useEffect(() => {
    if (!context) return;
    const { maps, map } = context;
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    clustererRef.current?.clear();
    clustererRef.current = null;

    const toPath = (ring: Position[]) => ring.map(([lng, lat]) => new maps.LatLng(lat, lng));
    for (const feature of boundary.features) {
      const polygons = feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
      for (const polygonCoordinates of polygons) {
        const polygon = new maps.Polygon({
          path: polygonCoordinates.map(toPath),
          strokeWeight: feature.properties.adm_cd2 === selectedRegionCode ? 4 : 1,
          strokeColor: feature.properties.adm_cd2 === selectedRegionCode ? "#172554" : "#ffffff",
          strokeOpacity: 0.9,
          fillColor: scoreColor(scores.get(feature.properties.adm_cd2)),
          fillOpacity: 0.74,
        });
        polygon.setMap(map);
        maps.event.addListener(polygon, "click", () => onSelectRegion(feature.properties.adm_cd2));
        overlaysRef.current.push(polygon);
      }
    }

    const selected = regions.find((region) => region.adm_cd2 === selectedRegionCode);
    if (selected) {
      const circle = new maps.Circle({
        center: new maps.LatLng(selected.representativePoint.lat, selected.representativePoint.lng),
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
      map.setCenter(new maps.LatLng(selected.representativePoint.lat, selected.representativePoint.lng));
    }

    const markerFacilities = facilities;
    if (markerFacilities.length) {
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
      const clusterer = new maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6 });
      clusterer.addMarkers(markers);
      clustererRef.current = clusterer;
    }

    return () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      overlaysRef.current = [];
      clustererRef.current?.clear();
      clustererRef.current = null;
    };
  }, [boundary, context, facilities, onSelectFacility, onSelectRegion, radiusKm, regions, scores, selectedRegionCode]);

  return (
    <div
      className="relative size-full bg-[#dfe8ef]"
      data-facilities-mode={showFacilities ? "all" : "analysis"}
    >
      <div ref={containerRef} className="size-full" aria-label="Kakao 부산 행정동 분석 지도" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/70 bg-white/88 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-xl">
        Kakao Maps
      </div>
      {!context ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100/65 backdrop-blur-sm">
          <p className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow">Kakao 지도를 연결하는 중…</p>
        </div>
      ) : null}
      <div className="absolute bottom-5 right-4 w-44 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-xl backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span>{legendLabel}</span><span>높음</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {LEGEND_COLORS.map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
          <span>정규화 0–100</span><span>100</span>
        </div>
      </div>
    </div>
  );
}
