import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { accumulateLine, finalizeEntry, parseHeader, toAdmCd2 } from "../../scripts/adapters/kcb-credit.mjs";

// Minimal header covering the columns the adapter reads (order matters for indices).
const HEADER = "CRTR_YM|ADM_CD|AP00002|MP00001|MP00003|MA00001|MS00002|MC00006|ML00001|MD00001|MD00003|ECON_CNT";
const IDX = parseHeader(HEADER);

function row(fields: Record<string, string | number>) {
  const order = "CRTR_YM|ADM_CD|AP00002|MP00001|MP00003|MA00001|MS00002|MC00006|ML00001|MD00001|MD00003|ECON_CNT".split("|");
  return order.map((k) => String(fields[k] ?? "")).join("|");
}

describe("kcb-credit adapter", () => {
  it("joins ADM_CD(8) → adm_cd2(10)", () => {
    expect(toAdmCd2("48250250")).toBe("4825025000");
  });

  it("filters to 경남 (ADM_CD prefix 48) and ignores 부산/울산 rows", () => {
    const acc = new Map();
    accumulateLine(acc, row({ CRTR_YM: "202512", ADM_CD: "26230680", MP00001: 100, MA00001: 3000 }), IDX); // 부산
    accumulateLine(acc, row({ CRTR_YM: "202512", ADM_CD: "48250250", MP00001: 100, MA00001: 3000 }), IDX); // 경남
    expect([...acc.keys()]).toEqual(["202512|48250250"]);
  });

  it("population-weights income & credit score across age bands, sums holders for ratios", () => {
    const acc = new Map();
    // dong 48250250, two age bands: pop 100 @income 2000천원, pop 300 @income 4000천원.
    // weighted income = (2000*100 + 4000*300)/400 = 3500천원 = 350만원.
    accumulateLine(acc, row({ CRTR_YM: "202512", ADM_CD: "48250250", MP00001: 100, MA00001: 2000, MS00002: 700, ML00001: 20, MD00001: 1, MD00003: 1, MP00003: 5, MC00006: 500, ECON_CNT: 100 }), IDX);
    accumulateLine(acc, row({ CRTR_YM: "202512", ADM_CD: "48250250", MP00001: 300, MA00001: 4000, MS00002: 800, ML00001: 60, MD00001: 3, MD00003: 1, MP00003: 15, MC00006: 900, ECON_CNT: 300 }), IDX);

    const m = finalizeEntry(acc.get("202512|48250250"));
    expect(m.avg_income).toBeCloseTo(350, 1); // (2000*100+4000*300)/400/10
    expect(m.credit_score).toBe(Math.round((700 * 100 + 800 * 300) / 400)); // 775
    expect(m.loan_ratio).toBeCloseTo((80 / 400) * 100, 1); // 20
    expect(m.delinquency_ratio).toBeCloseTo((6 / 400) * 100, 1); // 1.5
    expect(m.highend_ratio).toBeCloseTo((20 / 400) * 100, 1); // 5
    // card_spend weighted by ECON_CNT: (500*100+900*300)/400/10 = 80만원
    expect(m.card_spend).toBeCloseTo((500 * 100 + 900 * 300) / 400 / 10, 1);
  });

  it("returns null metrics when population is zero", () => {
    const acc = new Map();
    accumulateLine(acc, row({ CRTR_YM: "202512", ADM_CD: "48250250", MP00001: 0, MA00001: 0 }), IDX);
    const m = finalizeEntry(acc.get("202512|48250250"));
    expect(m.avg_income).toBeNull();
    expect(m.loan_ratio).toBeNull();
  });
});
