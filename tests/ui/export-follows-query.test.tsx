import { describe, expect, test } from "vitest";

/*
 * 화면은 31행인데 CSV가 305행으로 나갔다(prod 실측, Sonnet 3차 §1-③). 내보내기가
 * 필터 이전 목록(`analysis.ranked`)을 그대로 썼기 때문이다. 사용자는 화면을 보고
 * 내려받는데 파일에는 전혀 다른(더 많은) 데이터가 들어 있다.
 *
 * 갈라야 할 것은 **사용자가 적은 조건**(비율·개수·값)과 **화면이 정한 페이지 크기**다.
 * 조건은 파일에 반영하고, 페이징은 반영하지 않는다 — 조건 없이 물었는데 화면에 보이는
 * 24행만 내보내면 나머지가 잘린다.
 *
 * 이 규칙은 순수 계산이라 여기서 직접 확인한다. 화면 배선은 prod 검증
 * (`scripts/prod-checks/export-follows.mjs`)이 본다.
 */
function exportSlice(
  rows: number,
  opts: { percentLimit?: number | null; explicitCount?: number | null },
): number {
  const percentLimit = opts.percentLimit ?? null;
  const explicitCount = opts.explicitCount ?? null;
  const exportLimit =
    percentLimit !== null && rows > 0 ? Math.max(1, Math.ceil((rows * percentLimit) / 100)) : explicitCount;
  return exportLimit ? Math.min(exportLimit, rows) : rows;
}

describe("내보내기는 조건을 따르고 페이징은 따르지 않는다", () => {
  test("비율 조건은 파일에도 걸린다", () => {
    // "상위 10% 소득 지역" — 화면 31행, 파일도 31행이어야 한다(305행이 아니라).
    expect(exportSlice(305, { percentLimit: 10 })).toBe(31);
    expect(exportSlice(22, { percentLimit: 10 })).toBe(3);
  });

  test("사용자가 적은 개수는 파일에도 걸린다", () => {
    expect(exportSlice(305, { explicitCount: 5 })).toBe(5);
  });

  test("조건이 없으면 페이지 크기로 자르지 않는다", () => {
    // 화면은 24행만 보여 주지만 파일은 조건에 맞는 전부를 담아야 한다.
    expect(exportSlice(305, {})).toBe(305);
    expect(exportSlice(22, {})).toBe(22);
  });

  test("비율이 개수보다 앞선다 — 둘 다 있으면 비율이 답이다", () => {
    expect(exportSlice(305, { percentLimit: 10, explicitCount: 5 })).toBe(31);
  });

  test("올림한다 — 0행이 되지 않는다", () => {
    expect(exportSlice(22, { percentLimit: 1 })).toBe(1);
    expect(exportSlice(3, { percentLimit: 10 })).toBe(1);
  });

  test("행이 없으면 자를 것도 없다", () => {
    expect(exportSlice(0, { percentLimit: 10 })).toBe(0);
  });
});
