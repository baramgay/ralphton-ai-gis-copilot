"use client";

import { useEffect, useRef, useState } from "react";
import { buildScale, CHOROPLETH_COLORS } from "@/lib/gis/choropleth-scale";

import { facilityMarkerImageDataUri } from "@/lib/gis/facility-style";

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
  phone?: string | null;
  address?: string | null;
  roadAddress?: string | null;
};

type KakaoMapProps = {
  appKey: string;
  boundary: BoundaryCollection;
  regions: RegionSeries[];
  facilities: Facility[];
  livePlaces?: LiveMapPlace[];
  scores: Map<string, number>;
  selectedRegionCode: string | null;
  focusRegionCodes?: Set<string> | null;
  radiusKm: 1 | 2 | 3;
  showFacilities: boolean;
  /**
   * 선택 지역으로 지도를 옮길지. 사용자가 직접 고른 지역만 따라간다.
   *
   * 순위 1위를 자동 선택하는 것까지 따라가면 앱을 여는 순간 지도가 산속 읍면 하나로
   * 확대돼 화면이 단색으로 덮인다(prod 실측 — 첫 화면이 온통 파란 면이었다). 경남 전체
   * 분포를 보여 주는 것이 첫 화면의 일이다.
   */
  followSelection?: boolean;
  /** 반경 원을 그릴지. 2km 반경은 의료 접근성 분석에서만 뜻이 있다. */
  showRadius?: boolean;
  legendLabel?: string;
  onSelectRegion: (code: string) => void;
  onSelectFacility?: (facility: Facility) => void;
  onSelectLivePlace?: (place: LiveMapPlace) => void;
  onError: (message: string) => void;
  onReady?: () => void;
};

function makeTooltipElement(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "kakao-map-tooltip";
  el.textContent = text;
  el.style.cssText =
    "padding:6px 10px;border-radius:10px;background:rgba(15,23,42,.9);color:#fff;" +
    "font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 8px 20px rgba(15,23,42,.25);" +
    "pointer-events:none;transform:translateY(-4px);";
  return el;
}

const PLAIN_MARKER_CAP = 80;
const CLUSTER_MARKER_CAP = 350;

/** 경상남도 대략 중심(의령 부근)과 도 전체가 들어오는 확대 단계. */
const GYEONGNAM_CENTER = { lat: 35.32, lng: 128.35 };
const GYEONGNAM_LEVEL = 11;

/** 폴리곤 좌표를 재귀로 훑어 남서·북동 모서리를 구한다. */
function boundsOf(boundary: BoundaryCollection): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} | null {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  const walk = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === "number") {
      const [lng, lat] = coords as number[];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const part of coords as unknown[]) walk(part);
  };
  for (const feature of boundary.features) walk(feature.geometry.coordinates);
  return Number.isFinite(minLat) ? { minLat, minLng, maxLat, maxLng } : null;
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
  focusRegionCodes = null,
  radiusKm,
  showFacilities,
  followSelection = true,
  showRadius = true,
  legendLabel = "상대 분석값",
  onSelectRegion,
  onSelectFacility,
  onSelectLivePlace,
  onError,
  onReady,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const plainMarkersRef = useRef<KakaoOverlay[]>([]);
  const liveMarkersRef = useRef<KakaoOverlay[]>([]);
  const tooltipRef = useRef<KakaoOverlay | null>(null);
  const fittedBoundaryRef = useRef<string | null>(null);
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const [context, setContext] = useState<{
    maps: KakaoMapsNamespace;
    map: KakaoMapInstance;
    clustererReady: boolean;
  } | null>(null);
  const [status, setStatus] = useState("Kakao 지도를 연결하는 중…");

  /*
   * 최신 콜백을 ref에 담아 두는 흔한 수법이다. SDK 로드는 비동기라, 그 사이 부모가 새
   * 콜백을 넘겨도 지도를 다시 만들지 않고 최신 것을 부르려는 것이다.
   *
   * 다만 대입을 **렌더 중**에 하고 있었다. React 19의 동시 렌더에서는 버려지는 렌더가
   * 있어서, 화면에 반영되지도 않은 콜백이 ref에 남을 수 있다. 커밋된 뒤에만 쓰도록
   * effect로 옮긴다. 이 ref는 마운트 이후 비동기 콜백에서만 읽으므로 시점 문제도 없다.
   */
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    let attempts = 0;

    const bootMap = () => {
      loadKakaoSdk(appKey)
        .then((maps) => {
          if (!active || !containerRef.current) return;
          // 경상남도 중심. 부산 시청 좌표(35.1796, 129.0756)가 남아 있어 첫 프레임이
          // 도 밖에서 시작했다.
          const map = new maps.Map(containerRef.current, {
            center: new maps.LatLng(GYEONGNAM_CENTER.lat, GYEONGNAM_CENTER.lng),
            level: GYEONGNAM_LEVEL,
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
    tooltipRef.current?.setMap(null);
    tooltipRef.current = null;
    clustererRef.current?.clear();
    clustererRef.current = null;

    const toPath = (ring: Position[]) => ring.map(([lng, lat]) => new maps.LatLng(lat, lng));
    const regionByCode = new Map(regions.map((region) => [region.adm_cd2, region]));
    // 분위수 경계는 이번에 그릴 값 전체로 한 번만 계산한다.
    const scale = buildScale(scores);

    const showTooltip = (code: string, lat: number, lng: number) => {
      if (typeof maps.CustomOverlay !== "function") return;
      tooltipRef.current?.setMap(null);
      const region = regionByCode.get(code);
      const score = scores.get(code);
      const label = region
        ? `${region.adm_nm.replace("경상남도 ", "")}${score != null ? ` · ${score.toFixed(0)}` : ""}`
        : code;
      const overlay = new maps.CustomOverlay({
        content: makeTooltipElement(label),
        position: new maps.LatLng(lat, lng),
        yAnchor: 1.4,
        zIndex: 10,
      });
      overlay.setMap(map);
      tooltipRef.current = overlay;
    };

    for (const feature of boundary.features) {
      const polygons =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      const region = regionByCode.get(feature.properties.adm_cd2);
      const code = feature.properties.adm_cd2;
      const isSelected = code === selectedRegionCode;
      const isFocused = !focusRegionCodes || focusRegionCodes.has(code);
      const isDimmed = Boolean(focusRegionCodes && !isFocused);
      for (const polygonCoordinates of polygons) {
        const polygon = new maps.Polygon({
          path: polygonCoordinates.map(toPath),
          strokeWeight: isSelected ? 3 : isFocused && focusRegionCodes ? 2.2 : 1,
          strokeColor: isSelected
            ? "#172554"
            : isFocused && focusRegionCodes
              ? "#b45309"
              : "#ffffff",
          strokeOpacity: isDimmed ? 0.35 : 0.9,
          fillColor: isDimmed ? "#e8edf2" : scale.colorOf(code),
          fillOpacity: isDimmed ? 0.28 : isSelected ? 0.82 : 0.72,
        });
        polygon.setMap(map);
        maps.event.addListener(polygon, "click", () => onSelectRegion(code));
        maps.event.addListener(polygon, "mouseover", () => {
          if (region) {
            showTooltip(
              code,
              region.representativePoint.lat,
              region.representativePoint.lng,
            );
          }
        });
        maps.event.addListener(polygon, "mouseout", () => {
          tooltipRef.current?.setMap(null);
          tooltipRef.current = null;
        });
        overlaysRef.current.push(polygon);
      }
    }

    /*
     * 경계가 처음 들어오거나 다른 경계(격자)로 바뀌면 그 범위 전체가 보이게 한 번 맞춘다.
     * 그래야 첫 화면이 "경남 어디가 높고 낮은가"를 보여 준다. 그 뒤 사용자가 지도를 움직인
     * 것은 존중한다 — 매 렌더마다 다시 맞추면 확대해 둔 화면이 계속 튕겨 나온다.
     */
    const boundaryKey = `${boundary.features.length}:${boundary.features[0]?.properties.adm_cd2 ?? ""}`;
    if (fittedBoundaryRef.current !== boundaryKey) {
      fittedBoundaryRef.current = boundaryKey;
      const extent = boundsOf(boundary);
      if (extent) {
        if (typeof maps.LatLngBounds === "function" && typeof map.setBounds === "function") {
          const bounds = new maps.LatLngBounds();
          bounds.extend(new maps.LatLng(extent.minLat, extent.minLng));
          bounds.extend(new maps.LatLng(extent.maxLat, extent.maxLng));
          map.setBounds(bounds);
        } else {
          map.setCenter(
            new maps.LatLng((extent.minLat + extent.maxLat) / 2, (extent.minLng + extent.maxLng) / 2),
          );
          map.setLevel?.(GYEONGNAM_LEVEL);
        }
      }
    }

    const selected = regions.find((region) => region.adm_cd2 === selectedRegionCode);
    if (followSelection && !selected && selectedRegionCode) {
      /*
       * 격자처럼 스냅샷 지역 목록에 없는 코드는 여기서 못 찾는다. 그러면 지도가 이전
       * 위치에 그대로 머물러, 격자 레이어로 바꿨는데 화면은 엉뚱한 산속을 비춘다
       * (prod에서 실제로 그랬다). 경계 폴리곤에서 중심을 구해 옮겨 준다.
       * 반경 원은 의료 분석용 표시라 이 경우엔 그리지 않는다.
       */
      const feature = boundary.features.find((item) => item.properties.adm_cd2 === selectedRegionCode);
      if (feature) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        const walk = (coords: unknown): void => {
          if (typeof (coords as number[])[0] === "number") {
            const [lng, lat] = coords as number[];
            minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
            return;
          }
          for (const part of coords as unknown[]) walk(part);
        };
        walk(feature.geometry.coordinates);
        map.setCenter(new maps.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2));
        map.setLevel?.(5);
      }
    }
    if (selected) {
      // 반경 원은 "2km 안에 의료시설이 있는가"를 묻는 분석의 표시다. 생활인구·소비 순위에
      // 겹쳐 그리면 아무 뜻 없는 파란 원이 지도를 덮는다.
      if (showRadius) {
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
      }
      if (followSelection) {
        map.setCenter(
          new maps.LatLng(selected.representativePoint.lat, selected.representativePoint.lng),
        );
        map.setLevel?.(6);
      }
    }

    const useCluster = clustererReady && typeof maps.MarkerClusterer === "function";
    const cap = useCluster ? CLUSTER_MARKER_CAP : PLAIN_MARKER_CAP;
    const markerFacilities = prioritizeFacilities(
      facilities,
      selectedRegionCode,
      scores,
      cap,
    );

    const makeFacilityMarker = (facility: Facility) => {
      const position = new maps.LatLng(facility.lat, facility.lng);
      let image: object | undefined;
      if (typeof maps.MarkerImage === "function" && typeof maps.Size === "function") {
        try {
          image = new maps.MarkerImage(
            facilityMarkerImageDataUri(facility.type),
            new maps.Size(28, 28),
            typeof maps.Point === "function"
              ? { offset: new maps.Point(14, 14) }
              : undefined,
          );
        } catch {
          image = undefined;
        }
      }
      const marker = new maps.Marker({
        position,
        title: `${facility.name} · ${facility.type}`,
        image,
        zIndex: facility.adm_cd2 === selectedRegionCode ? 5 : 1,
      });
      if (onSelectFacility) {
        maps.event.addListener(marker, "click", () => onSelectFacility(facility));
      }
      return marker;
    };

    if (markerFacilities.length > 0) {
      const markers = markerFacilities.map(makeFacilityMarker);

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

    for (const place of livePlaces.slice(0, 20)) {
      const marker = new maps.Marker({
        position: new maps.LatLng(place.lat, place.lng),
        title: `실시간 · ${place.name}`,
        zIndex: 8,
      });
      maps.event.addListener(marker, "click", () => onSelectLivePlace?.(place));
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
      tooltipRef.current?.setMap(null);
      tooltipRef.current = null;
      clustererRef.current?.clear();
      clustererRef.current = null;
    };
  }, [
    boundary,
    context,
    facilities,
    livePlaces,
    onSelectFacility,
    onSelectLivePlace,
    onSelectRegion,
    radiusKm,
    regions,
    scores,
    selectedRegionCode,
    focusRegionCodes,
    showFacilities,
    followSelection,
    showRadius,
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
        aria-label="Kakao 경남 행정동 분석 지도"
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
      <div className="absolute bottom-5 right-4 w-48 rounded-2xl border border-white/80 bg-white/92 p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span className="truncate">{legendLabel}</span>
          <span>높음</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {CHOROPLETH_COLORS.map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-4 text-slate-400">
          5분위 채색(구간별 동 수 비슷) · 호버 시 이름·점수 · 시설 핀 색은 유형별
        </p>
      </div>
    </div>
  );
}
