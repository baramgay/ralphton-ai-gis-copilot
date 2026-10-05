import { describe, expect, it } from "vitest";
import { combineOfficialResidents, loadOfficialResidents } from "@/lib/data/official-residents";

describe("공식 인구의 게시본 선택", () => {
  it("완전하고 명시적 공식 근거가 있는 더 최신 게시본을 번들로 되돌리지 않는다", async () => {
    const official = await loadOfficialResidents();
    const newer = structuredClone(official);
    newer.months = official.months.slice(1).concat("2026-10");
    newer.referenceMonth = "2026-10";
    newer.sourceNotes = official.sourceNotes.map((n) => n.replaceAll("2025-09", "2025-10").replaceAll("2026-09", "2026-10"));
    newer.regions.forEach((r) => { r.months = [...newer.months]; });
    expect(combineOfficialResidents(official, newer).referenceMonth).toBe("2026-10");
  });
  it.each(["unknown", "synthetic", "partial", "wrong-code", "wrong-month", "age-mismatch"])("더 최신이어도 %s 게시본은 공식 번들 인구를 사용한다", async (defect) => {
    const official = await loadOfficialResidents();
    const cache = structuredClone(official);
    cache.months = official.months.slice(1).concat("2026-10");
    cache.referenceMonth = "2026-10";
    cache.regions.forEach((r) => { r.months = [...cache.months]; });
    cache.sourceNotes = official.sourceNotes.map((n) => n.replaceAll("2025-09", "2025-10").replaceAll("2026-09", "2026-10"));
    if (defect === "unknown") cache.sourceNotes = ["출처 불명"];
    if (defect === "synthetic") cache.sourceNotes.push("연령별 인구는 합성값입니다.");
    if (defect === "partial") cache.regions[0].population.pop();
    if (defect === "wrong-code") cache.regions[0].adm_cd2 = "1111053000";
    if (defect === "wrong-month") cache.regions[0].months = official.months;
    if (defect === "age-mismatch") cache.regions[0].elderlyPopulation[0]++;
    expect(combineOfficialResidents(official, cache).referenceMonth).toBe("2026-09");
  });
});
