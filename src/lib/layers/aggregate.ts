import type { LayerCell, LayerCube, MetricDef } from "@/lib/layers/types";

function sggCode(dongCode: string): string {
  return dongCode.slice(0, 5);
}

function sggName(dongName: string): string {
  // "경상남도 창원시 의창구 동읍" → "경상남도 창원시" (앞 2 토큰)
  const parts = dongName.split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

export function aggregateToSgg(cube: LayerCube, metrics: MetricDef[]): LayerCube {
  const groups = new Map<string, LayerCell[]>();
  for (const cell of cube.cells) {
    const code = sggCode(cell.code);
    const bucket = groups.get(code) ?? [];
    bucket.push(cell);
    groups.set(code, bucket);
  }

  const n = cube.months.length;
  const cells: LayerCell[] = [];

  for (const [code, members] of groups) {
    const series: Record<string, (number | null)[]> = {};
    for (const metric of metrics) {
      series[metric.key] = Array.from({ length: n }, (_, i) => {
        if (metric.aggregation === "sum") {
          let total = 0;
          for (const m of members) total += m.series[metric.key]?.[i] ?? 0;
          return total;
        }
        // weightedAvg
        const weightKey = metric.weightKey;
        let weighted = 0;
        let weight = 0;
        let only: number | null = null;
        let allSame = true;
        for (const m of members) {
          const v = m.series[metric.key]?.[i];
          const w = weightKey ? (m.series[weightKey]?.[i] ?? 0) : 1;
          if (v == null) continue;
          if (only === null) only = v;
          else if (v !== only) allSame = false;
          weighted += v * w;
          weight += w;
        }
        if (weight === 0) return null;
        /*
         * 구성원 값이 모두 같으면 그 값을 그대로 돌린다.
         *
         * 수학적으로는 나눗셈이 같은 값을 주지만 IEEE754는 그렇지 않다 — 8.4가 20칸
         * 있으면 8.400000000000004가 나온다. 시군구까지만 있는 원자료(KOSIS)는 소속
         * 읍면동이 전부 같은 값이라 **모든 칸이 이 경우**이고, "같은 값을 넣었으면 같은
         * 값이 나온다"는 불변식이 통째로 깨진다.
         */
        if (allSame && only !== null) return only;
        return weighted / weight;
      });
    }

    let area = 0;
    let latSum = 0;
    let lngSum = 0;
    for (const m of members) {
      area += m.areaKm2;
      latSum += m.point.lat;
      lngSum += m.point.lng;
    }

    cells.push({
      code,
      name: sggName(members[0].name),
      point: { lat: latSum / members.length, lng: lngSum / members.length },
      areaKm2: area,
      series,
    });
  }

  return {
    layerId: cube.layerId,
    adminLevel: "sgg",
    referenceMonth: cube.referenceMonth,
    months: cube.months,
    cells,
  };
}
