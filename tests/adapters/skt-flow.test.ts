import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { accumulateFlow, computeFlowIndices, emptyFlowAcc, finalizeFlow, isGyeongnam, parseFlowLine, regionName } from "../../scripts/adapters/skt-flow.mjs";

const BANDS = [
  "M00", "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60", "M65", "M70", "M75", "M80",
  "F00", "F10", "F15", "F20", "F25", "F30", "F35", "F40", "F45", "F50", "F55", "F60", "F65", "F70", "F75", "F80",
];
const INFLOW_COLUMNS = ["BASE_DATE", "SGG_CD", "RSDN_SGG_CD", ...BANDS];
const OUTFLOW_COLUMNS = ["BASE_DATE", "RSDN_SGG_CD", "SGG_CD", ...BANDS];

/** 밴드 32개에 같은 값을 넣는다 → 행 인원 = value × 32. */
function row(date: string, base: string, partner: string, value: number) {
  return [date, base, partner, ...BANDS.map(() => value)].join("|");
}

const NAMES = new Map([
  ["48250", "김해시"],
  ["48121", "창원시의창구"],
  ["48123", "창원시성산구"],
  ["26320", "북구"],
  ["31110", "중구"],
]);

describe("skt-flow 지역 간 이동 흐름", () => {
  /*
   * 유입 파일은 목적지가 경남, 유출 파일은 거주지가 경남이다. 자리를 굳혀 두면 한쪽
   * 파일에서 방향이 뒤집힌 채로 조용히 집계된다.
   */
  it("두 파일의 기준·상대 컬럼을 헤더로 가른다", () => {
    expect(computeFlowIndices(INFLOW_COLUMNS).inflow).toBe(true);
    expect(computeFlowIndices(OUTFLOW_COLUMNS).inflow).toBe(false);
    expect(computeFlowIndices(INFLOW_COLUMNS).numericStart).toBe(3);
  });

  it("두 번째 컬럼이 지역 코드가 아니면 멈춘다", () => {
    expect(() => computeFlowIndices(["BASE_DATE", "ADM_CD", "RSDN_SGG_CD"])).toThrow();
  });

  /*
   * 「중구」만 적으면 서울·부산·대구·인천·대전·울산 중 어디인지 알 수 없다. 보고서에
   * 그대로 실리는 이름이다.
   */
  it("경남 밖 지역에는 시도를 붙인다", () => {
    expect(regionName("31110", NAMES)).toBe("울산광역시 중구");
    expect(regionName("26320", NAMES)).toBe("부산광역시 북구");
  });

  it("경남 안 지역은 시도를 떼고 적는다", () => {
    expect(regionName("48250", NAMES)).toBe("김해시");
    expect(isGyeongnam("48250")).toBe(true);
    expect(isGyeongnam("26320")).toBe(false);
  });

  /* 세종은 하위 시군구가 없어 매핑표에 없다. 이름이 비면 화면에 빈칸이 나간다. */
  it("세종은 시도 이름이 곧 지역 이름이다", () => {
    expect(regionName("36110", NAMES)).toBe("세종특별자치시");
  });

  it("모르는 코드에는 이름을 지어내지 않는다", () => {
    expect(regionName("99999", NAMES)).toBeNull();
  });

  /*
   * 자기쌍(김해→김해)은 관내 거주자다. 2025-12 실측으로 김해시 자기쌍은 일평균
   * 541,525명, 다음 상대는 13,066명 — 같이 세면 순위가 아니라 그 도시의 인구를 본다.
   */
  it("자기 자신 쌍은 흐름으로 세지 않는다", () => {
    const indices = computeFlowIndices(INFLOW_COLUMNS);
    const acc = emptyFlowAcc();
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "48250", 100), indices));
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "26320", 1), indices));
    const result = finalizeFlow(acc, NAMES);
    expect(result.get("48250")!.total).toBeCloseTo(32, 6);
    expect(result.get("48250")!.top).toEqual([
      { code: "26320", name: "부산광역시 북구", value: 32 },
    ]);
  });

  /* 자기쌍만 있는 날을 분모에서 빼면 일평균이 부풀려진다. */
  it("자기쌍만 있는 날도 분모(일수)에는 센다", () => {
    const indices = computeFlowIndices(INFLOW_COLUMNS);
    const acc = emptyFlowAcc();
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "26320", 2), indices));
    accumulateFlow(acc, parseFlowLine(row("20251202", "48250", "48250", 99), indices));
    expect(finalizeFlow(acc, NAMES).get("48250")!.total).toBeCloseTo(32, 6); // 64 ÷ 2일
  });

  it("상대 지역을 인원 많은 순으로 세운다", () => {
    const indices = computeFlowIndices(INFLOW_COLUMNS);
    const acc = emptyFlowAcc();
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "26320", 1), indices));
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "31110", 3), indices));
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", "48121", 2), indices));
    const top = finalizeFlow(acc, NAMES).get("48250")!.top;
    expect(top.map((entry: { code: string }) => entry.code)).toEqual(["31110", "48121", "26320"]);
    expect(finalizeFlow(acc, NAMES).get("48250")!.total).toBeCloseTo(192, 6); // (1+3+2)×32
  });

  /* 원자료에 빈 따옴표 코드가 섞여 온다. 지역이 아니므로 세지 않고, 버린 수를 남긴다. */
  it("지역 코드가 아닌 행은 버리고 그 수를 센다", () => {
    const indices = computeFlowIndices(INFLOW_COLUMNS);
    const acc = emptyFlowAcc();
    accumulateFlow(acc, parseFlowLine(row("20251201", "48250", '""', 5), indices));
    accumulateFlow(acc, parseFlowLine("", indices));
    expect(acc.dropped).toBe(2);
    expect(finalizeFlow(acc, NAMES).size).toBe(0);
  });

  it("경남이 기준이 아닌 행은 세지 않는다", () => {
    const indices = computeFlowIndices(INFLOW_COLUMNS);
    expect(parseFlowLine(row("20251201", "26320", "48250", 5), indices)).toBeNull();
  });
});
