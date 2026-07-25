import type { LayerCube, LayerDescriptor, MetricDef } from "@/lib/layers/types";

export type ProfileEntry = {
  layerId: string;
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
  unit: string;
  value: number | null;
  /** 경남 전체 대비 백분위(0~100). 값이 없거나 비교 대상이 1개면 null. */
  percentile: number | null;
  referenceMonth: string;
};

export type RegionProfile = {
  code: string;
  name: string;
  entries: ProfileEntry[];
};

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

function monthIndexOf(cube: LayerCube): number {
  const index = cube.months.indexOf(cube.referenceMonth);
  return index >= 0 ? index : cube.months.length - 1;
}

/**
 * 백분위 = 이 값 이하인 지역의 비율. 100이면 경남 최상위, 0이면 최하위.
 * 절대값만으로는 "높은 편인가"를 알 수 없어, 대시보드에서는 순위 맥락이 필요하다.
 */
export function percentileOf(value: number, all: number[]): number | null {
  if (all.length <= 1) return null;
  const below = all.filter((other) => other <= value).length;
  return ((below - 1) / (all.length - 1)) * 100;
}

/**
 * 한 행정동의 모든 큐브 지표를 한 번에 모은다.
 *
 * 레이어를 하나씩 바꿔가며 보는 방식은 "이 동이 전반적으로 어떤 곳인가"를 알기 어렵다.
 * 여기서는 값과 함께 경남 전체 대비 백분위를 실어, 절대값만 보고 오판하지 않게 한다.
 * (사용자 규칙: 절대값 단독 판단 금지 — 비율·순위 맥락 병행)
 */
export function buildRegionProfile(
  code: string,
  name: string,
  layers: readonly LayerLike[],
  cubes: Record<string, LayerCube | null | undefined>,
): RegionProfile {
  const entries: ProfileEntry[] = [];

  for (const layer of layers) {
    const cube = cubes[layer.id];
    if (!cube) continue;
    const monthIndex = monthIndexOf(cube);
    const cell = cube.cells.find((candidate) => candidate.code === code);
    if (!cell) continue;

    for (const metric of layer.metrics as MetricDef[]) {
      const series = cell.series[metric.key];
      const value = series?.[monthIndex] ?? null;

      const all: number[] = [];
      for (const other of cube.cells) {
        const otherValue = other.series[metric.key]?.[monthIndex];
        if (typeof otherValue === "number" && Number.isFinite(otherValue)) all.push(otherValue);
      }

      entries.push({
        layerId: layer.id,
        layerLabel: layer.label,
        provider: layer.provider,
        metricKey: metric.key,
        metricLabel: metric.label,
        unit: metric.unit,
        value,
        percentile: value === null ? null : percentileOf(value, all),
        referenceMonth: cube.referenceMonth,
      });
    }
  }

  return { code, name, entries };
}
