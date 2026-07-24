import type { AnalysisSnapshot, RegionSeries } from "@/lib/domain/schemas";
import type { LayerCube } from "@/lib/layers/types";

function ratioSeries(num: number[], den: number[]): (number | null)[] {
  return num.map((n, i) => (den[i] ? (n / den[i]) * 100 : null));
}

export function populationCubeFromSnapshot(snapshot: AnalysisSnapshot): LayerCube {
  return {
    layerId: "population",
    adminLevel: "dong",
    referenceMonth: snapshot.referenceMonth,
    months: snapshot.months,
    cells: snapshot.regions.map((r: RegionSeries) => ({
      code: r.adm_cd2,
      name: r.adm_nm,
      point: r.representativePoint,
      areaKm2: r.areaSquareKm,
      series: {
        pop_total: [...r.population],
        households: [...r.households],
        density: [...r.populationDensity],
        elderly_ratio: ratioSeries([...r.elderlyPopulation], [...r.population]),
        natural_change: [...r.naturalChange],
      },
    })),
  };
}
