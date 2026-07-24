import { buildLayerView } from "@/lib/layers/select";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";

export type LayerMetricDescriptor = {
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  referenceMonth: string;
  limitation: string;
};

export type LayerAnalysisRow = {
  code: string;
  name: string;
  district: string;
  mapScore: number;
  valueLabel: string;
  note: string;
  metrics: LayerMetricDescriptor[];
};

export type LayerAnalysisView = {
  id: string;
  title: string;
  summary: string;
  ranked: LayerAnalysisRow[];
  filteredFacilities: never[];
  formulaNotes: string[];
  legendLabel: string;
  isFacilityResult: false;
};

export type LayerAnalysisResult = {
  analysis: LayerAnalysisView;
  scores: Map<string, number>;
};

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "데이터 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}

function districtOf(name: string): string {
  return name.replace(/^경상남도\s*/, "").split(/\s+/)[0] ?? "지역";
}

function monthIndexOf(cube: LayerCube): number {
  const index = cube.months.indexOf(cube.referenceMonth);
  return index >= 0 ? index : cube.months.length - 1;
}

/**
 * Adapts a generic LayerCube (population / skt-living / …) into the
 * AnalysisView-shaped object + scores map that the copilot UI already knows
 * how to render (ranking list, map choropleth, metric panel).
 *
 * `scores` keys come directly from `buildLayerView`'s dong-keyed scores map
 * (not re-derived from `ranked`, whose codes are sgg-level at the "sgg"
 * admin level) so the map's dong polygons always resolve correctly.
 */
export function layerCubeToAnalysisView(
  cube: LayerCube,
  metric: MetricDef,
  metrics: MetricDef[],
  adminLevel: AdminLevel,
): LayerAnalysisResult {
  const monthIndex = monthIndexOf(cube);
  const view = buildLayerView(cube, metric.key, adminLevel, monthIndex, metrics);

  const finiteValues = view.ranking
    .map((row) => row.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const minimum = finiteValues.length ? Math.min(...finiteValues) : 0;
  const maximum = finiteValues.length ? Math.max(...finiteValues) : 1;
  const span = Math.max(1, maximum - minimum);
  const normalize = (value: number) =>
    finiteValues.length <= 1 ? 50 : ((value - minimum) / span) * 100;

  const ranked: LayerAnalysisRow[] = view.ranking.map((row) => {
    const mapScore = row.value === null ? 0 : normalize(row.value);
    const name = row.name.replace(/^경상남도\s*/, "");
    return {
      code: row.code,
      name,
      district: districtOf(row.name),
      mapScore,
      valueLabel: formatValue(row.value, metric.unit),
      note: `${metric.label} · ${formatValue(row.value, metric.unit)}`,
      metrics: [
        {
          label: metric.label,
          value: row.value,
          unit: metric.unit,
          formula: metric.formula,
          referenceMonth: cube.referenceMonth,
          limitation: metric.limitation,
        },
      ],
    };
  });

  const scores = new Map<string, number>();
  for (const [code, value] of view.scores) {
    scores.set(code, normalize(value));
  }

  const levelLabel = adminLevel === "dong" ? "읍면동" : "시군구";

  return {
    analysis: {
      id: cube.layerId,
      title: `${metric.label} 순위`,
      summary: `${cube.referenceMonth} 기준 ${metric.label} (${levelLabel})`,
      ranked,
      filteredFacilities: [],
      formulaNotes: [metric.formula, metric.limitation].filter((note) => note.length > 0),
      legendLabel: `${metric.label} 분포`,
      isFacilityResult: false,
    },
    scores,
  };
}
