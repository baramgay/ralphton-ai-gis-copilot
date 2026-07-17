"use client";

import { useMemo, useState } from "react";

import type {
  BoundaryCollection,
  BoundaryFeature,
  Facility,
  Position,
  RegionSeries,
} from "./types";

type DemoMapProps = {
  boundary: BoundaryCollection;
  regions: RegionSeries[];
  facilities: Facility[];
  scores: Map<string, number>;
  selectedRegionCode: string | null;
  /** When set, non-listed dongs are dimmed (e.g. gu compare focus). */
  focusRegionCodes?: Set<string> | null;
  radiusKm: 1 | 2 | 3;
  showFacilities: boolean;
  legendLabel?: string;
  onSelectRegion: (code: string) => void;
  onSelectFacility?: (facility: Facility) => void;
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 900;
const PADDING = 30;
const COLORS = ["#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"];

function collectPositions(feature: BoundaryFeature): Position[] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.flat();
  }
  return feature.geometry.coordinates.flat(2);
}

function colorForScore(score: number | undefined): string {
  if (score == null || !Number.isFinite(score)) return "#e8eef5";
  const index = Math.min(COLORS.length - 1, Math.max(0, Math.floor(score / 20)));
  return COLORS[index];
}

export function DemoMap({
  boundary,
  regions,
  facilities,
  scores,
  selectedRegionCode,
  focusRegionCodes = null,
  radiusKm,
  showFacilities,
  legendLabel = "상대 분석값",
  onSelectRegion,
  onSelectFacility,
}: DemoMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const projection = useMemo(() => {
    const positions = boundary.features.flatMap(collectPositions);
    const longitudes = positions.map(([lng]) => lng);
    const latitudes = positions.map(([, lat]) => lat);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const usableWidth = VIEW_WIDTH - PADDING * 2;
    const usableHeight = VIEW_HEIGHT - PADDING * 2;
    const scale = Math.min(usableWidth / (maxLng - minLng), usableHeight / (maxLat - minLat));
    const drawnWidth = (maxLng - minLng) * scale;
    const drawnHeight = (maxLat - minLat) * scale;
    const offsetX = (VIEW_WIDTH - drawnWidth) / 2;
    const offsetY = (VIEW_HEIGHT - drawnHeight) / 2;

    return {
      point([lng, lat]: Position): [number, number] {
        return [offsetX + (lng - minLng) * scale, offsetY + (maxLat - lat) * scale];
      },
      pixelsPerKm: scale / (111 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))),
    };
  }, [boundary]);

  const pathForFeature = (feature: BoundaryFeature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return polygons
      .flatMap((polygon) =>
        polygon.map((ring) =>
          ring
            .map((position, index) => {
              const [x, y] = projection.point(position);
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ") + " Z",
        ),
      )
      .join(" ");
  };

  const selectedRegion = regions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null;
  const hoveredFeature = boundary.features.find((feature) => feature.properties.adm_cd2 === hovered);
  const visibleFacilities = facilities;

  return (
    <div
      className="relative size-full overflow-hidden bg-[#dfe8ef]"
      data-facilities-mode={showFacilities ? "all" : "analysis"}
      data-testid="demo-map"
    >
      <svg
        className="size-full touch-none select-none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="부산 행정동 분석 지도"
      >
        <defs>
          <filter id="map-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#12304a" floodOpacity=".14" />
          </filter>
          <radialGradient id="buffer-fill">
            <stop offset="0" stopColor="#2563eb" stopOpacity=".12" />
            <stop offset="1" stopColor="#2563eb" stopOpacity=".03" />
          </radialGradient>
        </defs>
        <g
          className="origin-center transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `scale(${zoom})` }}
        >
          <g filter="url(#map-shadow)">
            {boundary.features.map((feature) => {
              const code = feature.properties.adm_cd2;
              const isSelected = code === selectedRegionCode;
              const isHovered = code === hovered;
              const isFocused = !focusRegionCodes || focusRegionCodes.has(code);
              const isDimmed = Boolean(focusRegionCodes && !isFocused);
              return (
                <path
                  key={code}
                  d={pathForFeature(feature)}
                  fill={isDimmed ? "#e8edf2" : colorForScore(scores.get(code))}
                  fillRule="evenodd"
                  fillOpacity={isDimmed ? 0.42 : 1}
                  stroke={
                    isSelected
                      ? "#172554"
                      : isFocused && focusRegionCodes
                        ? "#b45309"
                        : isHovered
                          ? "#2563eb"
                          : "#ffffff"
                  }
                  strokeWidth={
                    isSelected ? 3.4 : isFocused && focusRegionCodes ? 2.4 : isHovered ? 2.2 : 0.9
                  }
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer transition-colors duration-150 outline-none focus-visible:stroke-blue-950"
                  role="button"
                  tabIndex={0}
                  aria-label={`${feature.properties.adm_nm} 선택`}
                  data-focus={isFocused ? "1" : "0"}
                  data-dimmed={isDimmed ? "1" : "0"}
                  onPointerEnter={() => setHovered(code)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(code)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelectRegion(code)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRegion(code);
                    }
                  }}
                />
              );
            })}
          </g>

          {selectedRegion ? (
            <circle
              cx={projection.point([
                selectedRegion.representativePoint.lng,
                selectedRegion.representativePoint.lat,
              ])[0]}
              cy={projection.point([
                selectedRegion.representativePoint.lng,
                selectedRegion.representativePoint.lat,
              ])[1]}
              r={Math.max(8, radiusKm * projection.pixelsPerKm)}
              fill="url(#buffer-fill)"
              stroke="#2563eb"
              strokeWidth="2"
              strokeDasharray="7 5"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}

          {visibleFacilities.map((facility) => {
            const [x, y] = projection.point([facility.lng, facility.lat]);
            return (
              <g
                key={facility.id}
                transform={`translate(${x} ${y})`}
                role={onSelectFacility ? "button" : undefined}
                tabIndex={onSelectFacility ? 0 : undefined}
                aria-label={onSelectFacility ? `${facility.name} · ${facility.type} 선택` : undefined}
                className={onSelectFacility ? "cursor-pointer outline-none focus-visible:stroke-blue-950" : undefined}
                onClick={() => onSelectFacility?.(facility)}
                onKeyDown={(event) => {
                  if (onSelectFacility && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onSelectFacility(facility);
                  }
                }}
              >
                <circle r="5.5" fill="#ffffff" stroke="#0f172a" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                <circle r="2.2" fill={facility.type === "종합병원" ? "#dc2626" : "#2563eb"} />
                <title>{`${facility.name} · ${facility.type}`}</title>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/70 bg-white/88 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-xl">
        DemoMap
      </div>

      {hoveredFeature ? (
        <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-xl border border-white/70 bg-slate-950/88 px-3 py-2 text-xs font-medium text-white shadow-xl backdrop-blur-xl">
          {hoveredFeature.properties.adm_nm.replace("부산광역시 ", "")}
        </div>
      ) : null}

      <div className="absolute right-4 top-4 flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/92 shadow-lg backdrop-blur-xl">
        <button
          type="button"
          className="grid size-10 place-items-center text-xl font-light text-slate-700 hover:bg-slate-50 active:bg-slate-100"
          aria-label="지도 확대"
          onClick={() => setZoom((current) => Math.min(1.8, current + 0.2))}
        >
          +
        </button>
        <span className="h-px bg-slate-200" />
        <button
          type="button"
          className="grid size-10 place-items-center text-xl font-light text-slate-700 hover:bg-slate-50 active:bg-slate-100"
          aria-label="지도 축소"
          onClick={() => setZoom((current) => Math.max(0.8, current - 0.2))}
        >
          −
        </button>
      </div>

      <div className="absolute bottom-5 right-4 w-44 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-xl backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span>{legendLabel}</span><span>높음</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {COLORS.map((color) => <span key={color} className="flex-1" style={{ backgroundColor: color }} />)}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
          <span>정규화 0–100</span><span>100</span>
        </div>
      </div>
    </div>
  );
}
