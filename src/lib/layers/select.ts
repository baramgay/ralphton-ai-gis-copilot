import { aggregateToSgg } from "@/lib/layers/aggregate";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";

export type LayerRankRow = { code: string; name: string; value: number | null };
export type LayerView = {
  scores: Map<string, number>;
  ranking: LayerRankRow[];
};

function metricValue(
  series: Record<string, (number | null)[]>,
  metricKey: string,
  monthIndex: number,
): number | null {
  return series[metricKey]?.[monthIndex] ?? null;
}

function sortRanking(rows: LayerRankRow[]): LayerRankRow[] {
  return [...rows].sort((a, b) => {
    if (a.value == null && b.value == null) return 0;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return b.value - a.value;
  });
}

export function buildLayerView(
  cube: LayerCube,
  metricKey: string,
  adminLevel: AdminLevel,
  monthIndex: number,
  metrics: MetricDef[],
): LayerView {
  if (adminLevel === "dong") {
    const scores = new Map<string, number>();
    const ranking: LayerRankRow[] = cube.cells.map((cell) => {
      const value = metricValue(cell.series, metricKey, monthIndex);
      if (value != null) scores.set(cell.code, value);
      return { code: cell.code, name: cell.name, value };
    });
    return { scores, ranking: sortRanking(ranking) };
  }

  const sggCube = aggregateToSgg(cube, metrics);
  const sggValues = new Map<string, number>();
  const ranking: LayerRankRow[] = sggCube.cells.map((cell) => {
    const value = metricValue(cell.series, metricKey, monthIndex);
    if (value != null) sggValues.set(cell.code, value);
    return { code: cell.code, name: cell.name, value };
  });

  const scores = new Map<string, number>();
  for (const dongCell of cube.cells) {
    const sggValue = sggValues.get(dongCell.code.slice(0, 5));
    if (sggValue != null) scores.set(dongCell.code, sggValue);
  }

  return { scores, ranking: sortRanking(ranking) };
}
