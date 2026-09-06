"use client";

import { useMemo, useState } from "react";
import { buildScale, choroplethRamp } from "@/lib/gis/choropleth-scale";
import { useAppliedTheme } from "@/lib/ui/use-applied-theme";

import { sggLabelPoints } from "@/lib/gis/sgg-label";

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
  outlineMode?: boolean;
  showSggLabels?: boolean;
  legendLabel?: string;
  viewLabel?: string;
  onSelectRegion: (code: string) => void;
  onSelectFacility?: (facility: Facility) => void;
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 900;
const PADDING = 30;

function collectPositions(feature: BoundaryFeature): Position[] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.flat();
  }
  return feature.geometry.coordinates.flat(2);
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
  outlineMode = false,
  showSggLabels = false,
  legendLabel = "상대 분석값",
  viewLabel,
  onSelectRegion,
  onSelectFacility,
}: DemoMapProps) {
  /*
   * 색띠는 테마를 따른다. 밝은 화면의 색띠를 어두운 지도에 그대로 쓰면 **낮은 단계가
   * 가장 밝아** 값이 낮은 곳이 제일 도드라진다(거꾸로 된 지도).
   */
  const appliedTheme = useAppliedTheme();
  const choroplethTheme = appliedTheme === "light" ? "light" : "dark";
  const ramp = choroplethRamp(choroplethTheme);

  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // 분위수 경계는 지도에 그릴 값 전체로 한 번만 계산한다.
  const scale = useMemo(() => buildScale(scores, choroplethTheme), [scores, choroplethTheme]);

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
  const sggLabels = useMemo(
    () => (showSggLabels ? sggLabelPoints(regions) : []),
    [regions, showSggLabels],
  );

  return (
    <div
      className="relative size-full overflow-hidden bg-[#dfe8ef]"
      data-facilities-mode={showFacilities ? "all" : "analysis"}
      data-outline={outlineMode ? "1" : "0"}
      data-testid="demo-map"
    >
      <svg
        className="size-full touch-none select-none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="경상남도 행정동 분석 지도"
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
                  fill={
                    outlineMode
                      ? choroplethTheme === "dark"
                        ? "#0a1120"
                        : "#ffffff"
                      : isDimmed
                        ? "#e8edf2"
                        : scale.colorOf(code)
                  }
                  fillRule="evenodd"
                  fillOpacity={outlineMode ? 0.08 : isDimmed ? 0.42 : 1}
                  stroke={
                    outlineMode
                      ? choroplethTheme === "dark"
                        ? "#94a3b8"
                        : "#334155"
                      : isSelected
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

          {sggLabels.map((label) => {
            const [x, y] = projection.point([label.lng, label.lat]);
            return (
              <text
                key={label.code}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="map-sgg-label-svg"
                data-testid="map-sgg-label"
              >
                {label.name}
              </text>
            );
          })}

          {selectedRegion && !outlineMode ? (
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

      <div className="map-chip map-chip-topleft" data-testid="demo-map-badge">
        {viewLabel ?? "임시 지도"}
      </div>

      {hoveredFeature ? (
        <div className="map-hover-chip">
          {hoveredFeature.properties.adm_nm.replace("경상남도 ", "")}
        </div>
      ) : null}

      <div className="map-zoom">
        <button
          type="button"
          className="grid size-10 place-items-center"
          aria-label="지도 확대"
          onClick={() => setZoom((current) => Math.min(1.8, current + 0.2))}
        >
          +
        </button>
        <span className="map-zoom-split" />
        <button
          type="button"
          className="grid size-10 place-items-center"
          aria-label="지도 축소"
          onClick={() => setZoom((current) => Math.max(0.8, current - 0.2))}
        >
          −
        </button>
      </div>

      {outlineMode ? null : (
      <div className="map-legend map-legend-narrow">
        <div className="map-legend-head">
          <span>{legendLabel}</span><span>높음</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {ramp.map((color) => <span key={color} className="flex-1" style={{ backgroundColor: color }} />)}
        </div>
        <div className="map-legend-note flex justify-between">
          <span>5분위(같은 수의 동)</span><span>높음</span>
        </div>
      </div>
      )}
    </div>
  );
}
