import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { accumulateLine, createAccumulator, finalizeDong, parseHeader, quarterLabel, toAdmCd2 } from "../../scripts/adapters/kcb-commute.mjs";

const HEADER = "CRTR_YQ|CUR_CTN_CD|CUR_ADM_CD|COM_CTN_CD|COM_ADM_CD|MP00001";
const IDX = parseHeader(HEADER);

function row(curDong: string, comDong: string, people: number, yq = "20254") {
  return [yq, curDong.slice(0, 5), curDong, comDong.slice(0, 5), comDong, String(people)].join("|");
}

describe("kcb-commute adapter", () => {
  it("maps quarter codes to the closing month and builds adm_cd2", () => {
    expect(quarterLabel("20251")).toBe("2025-03");
    expect(quarterLabel("20254")).toBe("2025-12");
    expect(toAdmCd2("48330253")).toBe("4833025300");
  });

  it("counts inbound jobs by workplace dong, including workers living elsewhere", () => {
    const acc = createAccumulator();
    acc.jobs.clear();
    accumulateLine(acc, row("48250110", "48120510", 30), IDX); // 김해 거주 → 창원 직장
    accumulateLine(acc, row("26410665", "48120510", 20), IDX); // 부산 거주 → 창원 직장
    accumulateLine(acc, row("48120510", "26140615", 15), IDX); // 창원 거주 → 부산 직장(경남 일자리 아님)

    expect(acc.jobs.get("20254|48120510")).toBe(50); // 30 + 20
    expect(acc.jobs.has("20254|26140615")).toBe(false); // 경남 밖 직장은 집계하지 않는다
  });

  it("splits residents into total workers and those commuting out of their sgg", () => {
    const acc = createAccumulator();
    accumulateLine(acc, row("48330253", "48330540", 40), IDX); // 같은 시군구(48330) 내 통근
    accumulateLine(acc, row("48330253", "48120510", 60), IDX); // 시군구 밖(양산→창원)

    const resident = acc.residents.get("20254|48330253");
    expect(resident.working).toBe(100);
    expect(resident.outbound).toBe(60);
  });

  it("derives outbound ratio and the job-to-resident ratio", () => {
    const metrics = finalizeDong(150, { working: 100, outbound: 60 });
    expect(metrics.jobs_in).toBe(150);
    expect(metrics.outbound_ratio).toBeCloseTo(60, 6);
    // 일자리 150 vs 취업 거주자 100 → 150% = 직장 중심지
    expect(metrics.job_ratio).toBeCloseTo(150, 6);
  });

  it("returns null ratios when a dong has no working residents", () => {
    const metrics = finalizeDong(20, undefined);
    expect(metrics.jobs_in).toBe(20);
    expect(metrics.outbound_ratio).toBeNull();
    expect(metrics.job_ratio).toBeNull();
  });

  it("keeps quarters separate", () => {
    const acc = createAccumulator();
    accumulateLine(acc, row("48330253", "48120510", 10, "20253"), IDX);
    accumulateLine(acc, row("48330253", "48120510", 4, "20254"), IDX);
    expect(acc.residents.get("20253|48330253").working).toBe(10);
    expect(acc.residents.get("20254|48330253").working).toBe(4);
  });
});
