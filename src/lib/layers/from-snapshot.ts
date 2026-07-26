import { rankHospitalScarcity } from "@/lib/analysis/tool-registry";
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

/**
 * 의료취약지수를 교차분석에 쓸 수 있는 큐브로 만든다.
 *
 * 이 지표는 원격 큐브가 아니라 스냅샷에서 그때그때 계산되는 값이라 CUBE_LAYERS에 없었고,
 * 그래서 "소득 낮고 의료 취약한 지역" 같은 질의가 교차로 가지 못하고 소득 한쪽만 답했다.
 * 정책 질의로는 가장 자연스러운 축인데 비어 있던 셈이다.
 *
 * 시설 자료에는 시계열이 없으므로 **기준월 한 시점만** 담는다. 추세를 물으면 관측이
 * 하나라 산출되지 않는데, 그것이 사실이다(없는 시계열을 지어내지 않는다).
 */
export function medicalCubeFromSnapshot(snapshot: AnalysisSnapshot): LayerCube {
  const result = rankHospitalScarcity(
    { tool: "rankHospitalScarcity", filters: { limit: snapshot.regions.length } },
    snapshot,
  );
  const scoreByCode = new Map(result.rankedRegions.map((region) => [region.adm_cd2, region.score]));
  const monthIndex = Math.max(0, snapshot.months.indexOf(snapshot.referenceMonth));

  return {
    layerId: "medical",
    adminLevel: "dong",
    referenceMonth: snapshot.referenceMonth,
    months: [snapshot.referenceMonth],
    cells: snapshot.regions.map((r: RegionSeries) => ({
      code: r.adm_cd2,
      name: r.adm_nm,
      point: r.representativePoint,
      areaKm2: r.areaSquareKm,
      series: {
        vulnerability: [scoreByCode.get(r.adm_cd2) ?? null],
        // 시군구로 묶을 때 인구 가중평균을 내려면 분모가 같은 큐브에 있어야 한다.
        pop_total: [r.population[monthIndex] ?? null],
      },
    })),
  };
}
