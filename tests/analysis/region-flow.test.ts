import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { selectRegionFlow, sggCodeOf, type FlowData } from "@/lib/analysis/region-flow";

const SAMPLE: FlowData = {
  months: ["2025-11", "2025-12"],
  referenceMonth: "2025-12",
  topN: 8,
  regions: [
    {
      code: "48250",
      name: "김해시",
      inflow: {
        totals: [100, 200],
        top: [
          [{ code: "26320", name: "부산광역시 북구", value: 60 }],
          [
            { code: "26320", name: "부산광역시 북구", value: 100 },
            { code: "48121", name: "창원시 의창구", value: 50 },
            { code: "99999", name: null, value: 10 },
          ],
        ],
      },
      outflow: { totals: [90, 250], top: [null, [{ code: "26440", name: "부산광역시 강서구", value: 125 }]] },
    },
  ],
};

describe("지역 간 이동 흐름", () => {
  test("행정동 코드에서도 시군구를 찾는다", () => {
    expect(sggCodeOf("4825051000")).toBe("48250");
    expect(sggCodeOf("48250")).toBe("48250");
  });

  test("기준월의 흐름을 고른다", () => {
    const view = selectRegionFlow(SAMPLE, "4825051000")!;
    expect(view.month).toBe("2025-12");
    expect(view.sggName).toBe("김해시");
    expect(view.inflowTotal).toBe(200);
    expect(view.outflowTotal).toBe(250);
    expect(view.netFlow).toBe(-50);
  });

  test("비중은 관외 총합 대비다", () => {
    const view = selectRegionFlow(SAMPLE, "48250")!;
    expect(view.inbound[0]!.share).toBeCloseTo(50, 6); // 100 / 200
    expect(view.outbound[0]!.share).toBeCloseTo(50, 6); // 125 / 250
  });

  /* 빈 줄은 「자료 없음」으로 읽힌다. 이름을 못 찾아도 무엇인지는 적는다. */
  test("이름 없는 상대도 빈칸으로 두지 않는다", () => {
    const view = selectRegionFlow(SAMPLE, "48250")!;
    expect(view.inbound[2]!.label).toBe("코드 99999");
  });

  test("상위 몇 곳만 자른다", () => {
    expect(selectRegionFlow(SAMPLE, "48250", 2)!.inbound).toHaveLength(2);
  });

  /* 자료가 없으면 null이다. 0으로 채우면 결손이 「흐름 없음」으로 인쇄된다. */
  test("자료가 없는 지역은 null을 돌린다", () => {
    expect(selectRegionFlow(SAMPLE, "48999")).toBeNull();
    expect(selectRegionFlow(null, "48250")).toBeNull();
    expect(selectRegionFlow(SAMPLE, null)).toBeNull();
  });

  test("그 달의 상대 목록이 비어 있으면 빈 목록이다", () => {
    const view = selectRegionFlow(
      { ...SAMPLE, referenceMonth: "2025-11" },
      "48250",
    )!;
    expect(view.outbound).toEqual([]);
    expect(view.inbound).toHaveLength(1);
  });
});

/*
 * 생성된 실제 자료를 본다. 방향(유입/유출)을 한 번 뒤집으면 화면은 그럴듯하게 채워지고
 * 유닛 테스트는 통과한다 — 「A로 들어오는 B」와 「B에서 나가는 A」가 **같은 값**이어야
 * 한다는 것이 두 파일을 맞대 볼 수 있는 유일한 잣대다.
 */
describe("생성된 흐름 자료", () => {
  const file = path.join(process.cwd(), "public", "data", "flows", "skt-flow.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as FlowData;

  test("경남 시군구 22곳 · 12개월", () => {
    expect(data.regions).toHaveLength(22);
    expect(data.months).toHaveLength(12);
    expect(data.months.includes(data.referenceMonth)).toBe(true);
  });

  test("상대 지역 이름을 하나도 비우지 않는다", () => {
    const missing = data.regions.flatMap((region) =>
      [...region.inflow.top, ...region.outflow.top].flatMap((month) =>
        (month ?? []).filter((partner) => !partner.name).map((partner) => partner.code),
      ),
    );
    expect(missing).toEqual([]);
  });

  test("A로 들어오는 B와 B에서 나가는 A는 같은 값이다", () => {
    const index = data.months.indexOf(data.referenceMonth);
    const byCode = new Map(data.regions.map((region) => [region.code, region]));
    let compared = 0;
    for (const region of data.regions) {
      for (const partner of region.inflow.top[index] ?? []) {
        const other = byCode.get(partner.code);
        if (!other) continue; // 경남 밖은 유출 자료가 없다
        const back = (other.outflow.top[index] ?? []).find((entry) => entry.code === region.code);
        if (!back) continue; // 상위 8곳 밖으로 잘렸으면 맞댈 수 없다
        expect(back.value).toBeCloseTo(partner.value, 1);
        compared += 1;
      }
    }
    /* 맞대 본 쌍이 없으면 이 검사는 아무것도 안 한 것이다. */
    expect(compared).toBeGreaterThan(10);
  });

  test("관외 총합은 상위 목록의 합보다 크거나 같다", () => {
    const index = data.months.indexOf(data.referenceMonth);
    for (const region of data.regions) {
      const top = (region.inflow.top[index] ?? []).reduce((sum, entry) => sum + entry.value, 0);
      expect(region.inflow.totals[index]!).toBeGreaterThanOrEqual(top - 0.5);
    }
  });
});
