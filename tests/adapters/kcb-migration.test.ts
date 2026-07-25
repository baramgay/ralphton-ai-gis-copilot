import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { accumulateInflow, accumulateOutflow, INFLOW_COLUMNS, isExternalMove, isGyeongnam, OUTFLOW_COLUMNS, parseHeader, quarterLabel, toAdmCd2 } from "../../scripts/adapters/kcb-migration.mjs";

const IN_HEADER = "PRV_YQ|PRV_PVN_CD|PRV_CTN_CD|CRTR_YQ|CUR_CTN_CD|CUR_ADM_CD|MP00001";
const OUT_HEADER = "PRV_YQ|PRV_PVN_CD|PRV_CTN_CD|CRTR_YQ|CUR_CTN_CD|CUR_ADM_CD|MP00001";
const IN_IDX = parseHeader(IN_HEADER, INFLOW_COLUMNS);
const OUT_IDX = parseHeader(OUT_HEADER, OUTFLOW_COLUMNS);

function inRow(curAdm: string, people: number, yq = "20254", prvCtn = "27710") {
  return ["20234", "27", prvCtn, yq, curAdm.slice(0, 5), curAdm, String(people)].join("|");
}
function outRow(prvCtn: string, people: number, yq = "20254", curAdm = "44200350") {
  return ["20234", prvCtn.slice(0, 2), prvCtn, yq, curAdm.slice(0, 5), curAdm, String(people)].join("|");
}

describe("kcb-migration adapter", () => {
  it("maps a quarter code to its closing month (schema requires YYYY-MM)", () => {
    expect(quarterLabel("20251")).toBe("2025-03");
    expect(quarterLabel("20254")).toBe("2025-12");
  });

  it("recognizes Gyeongnam codes and builds adm_cd2", () => {
    expect(isGyeongnam("48330540")).toBe(true);
    expect(isGyeongnam("26440")).toBe(false);
    expect(toAdmCd2("48330540")).toBe("4833054000");
  });

  it("counts a move only when the origin sgg differs and is known", () => {
    expect(isExternalMove("27710", "48330")).toBe(true);
    expect(isExternalMove("48330", "48330")).toBe(false); // stayed in / moved within the same sgg
    expect(isExternalMove("99999", "48330")).toBe(false); // unknown prior residence
  });

  it("inflow: sums external in-movers by destination dong, keeping only Gyeongnam destinations", () => {
    const acc = new Map();
    accumulateInflow(acc, inRow("48330540", 10), IN_IDX); // origin 27710 ≠ 48330 → counted
    accumulateInflow(acc, inRow("48330540", 5, "20254", "11110"), IN_IDX); // another external origin
    accumulateInflow(acc, inRow("26440520", 99), IN_IDX); // 부산 destination → ignored
    expect(acc.get("20254|48330540")).toBe(15);
    expect(acc.size).toBe(1);
  });

  it("inflow: excludes same-sgg rows, which dominate the raw file (non-movers)", () => {
    const acc = new Map();
    // origin sgg == destination sgg (48330) → not an in-migration
    accumulateInflow(acc, inRow("48330540", 81990, "20254", "48330"), IN_IDX);
    accumulateInflow(acc, inRow("48330540", 8861, "20254", "27710"), IN_IDX);
    expect(acc.get("20254|48330540")).toBe(8861);
  });

  it("inflow: keeps quarters separate", () => {
    const acc = new Map();
    accumulateInflow(acc, inRow("48330540", 10, "20253"), IN_IDX);
    accumulateInflow(acc, inRow("48330540", 4, "20254"), IN_IDX);
    expect(acc.get("20253|48330540")).toBe(10);
    expect(acc.get("20254|48330540")).toBe(4);
  });

  it("outflow: sums external out-movers by ORIGIN sgg, keeping only Gyeongnam origins", () => {
    const acc = new Map();
    accumulateOutflow(acc, outRow("48330", 7), OUT_IDX); // to 44200 → external
    accumulateOutflow(acc, outRow("48330", 3), OUT_IDX);
    accumulateOutflow(acc, outRow("48330", 500, "20254", "48330540"), OUT_IDX); // stayed in 48330 → ignored
    accumulateOutflow(acc, outRow("26440", 50), OUT_IDX); // 부산 origin → ignored
    expect(acc.get("20254|48330")).toBe(10);
    expect(acc.size).toBe(1);
  });

  it("ignores blank lines and non-numeric people counts", () => {
    const acc = new Map();
    accumulateInflow(acc, "", IN_IDX);
    accumulateInflow(acc, inRow("48330540", Number.NaN), IN_IDX);
    expect(acc.size).toBe(0);
  });
});
