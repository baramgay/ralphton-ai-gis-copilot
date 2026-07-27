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

/** 값 없는 지역은 방향과 무관하게 항상 뒤로 보낸다. */
function sortRanking(rows: LayerRankRow[], direction: "desc" | "asc" = "desc"): LayerRankRow[] {
  return [...rows].sort((a, b) => {
    if (a.value == null && b.value == null) return 0;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return direction === "asc" ? a.value - b.value : b.value - a.value;
  });
}

export function buildLayerView(
  cube: LayerCube,
  metricKey: string,
  adminLevel: AdminLevel,
  monthIndex: number,
  metrics: MetricDef[],
  direction: "desc" | "asc" = "desc",
  /** 이 이름들 중 하나라도 든 지역만 순위에 남긴다(공백 무시). 지도 채색은 그대로 둔다. */
  regionFilters: readonly string[] = [],
): LayerView {
  const compactFilters = regionFilters.map((filter) => filter.replace(/\s+/g, "")).filter(Boolean);
  const inRegion = (name: string) => {
    if (compactFilters.length === 0) return true;
    const compactName = name.replace(/\s+/g, "");
    return compactFilters.some((filter) => compactName.includes(filter));
  };
  if (adminLevel === "dong") {
    const scores = new Map<string, number>();
    const ranking: LayerRankRow[] = cube.cells.map((cell) => {
      const value = metricValue(cell.series, metricKey, monthIndex);
      if (value != null) scores.set(cell.code, value);
      return { code: cell.code, name: cell.name, value };
    });
    return { scores, ranking: sortRanking(ranking.filter((row) => inRegion(row.name)), direction) };
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

  return { scores, ranking: sortRanking(ranking.filter((row) => inRegion(row.name)), direction) };
}
