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
          /*
           * 하나라도 비면 **합계를 내지 않는다.**
           *
           * 있는 것만 더하면 실제보다 작은 값이 그럴듯한 얼굴로 순위에 올라간다 — 결손이
           * 「낮은 지역」으로 인쇄되는 것이다. 실제로 그런 자료가 있다(2026-09-04 실측):
           * `kcb-migration.move_in` 1개 시군구, `nh-demographics.card_sales` 2곳,
           * `nh-hourly.day_sales`·`night_sales` 3곳에서 소속 동 일부만 null이다.
           *
           * 같은 저장소가 이미 같은 판단을 해 두었다 — `tool-registry.ts`의
           * `sumNullableSeries`가 1인가구에서 똑같이 null을 전파한다. 여기만 예외였다.
           *
           * 대가는 그 시군구가 순위에서 「자료 없음」이 되는 것이다. 그편이 낫다:
           * 없는 것은 없다고 말할 수 있어도, 작게 적힌 값은 되돌릴 수 없다.
           */
          let total = 0;
          for (const m of members) {
            const value = m.series[metric.key]?.[i];
            if (value == null || !Number.isFinite(value)) return null;
            total += value;
          }
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
