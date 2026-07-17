import { describe, expect, test } from "vitest";

import { selectLatestCommonMonth } from "@/lib/domain/periods";

describe("selectLatestCommonMonth", () => {
  test("returns the latest month present in every array", () => {
    expect(
      selectLatestCommonMonth([
        ["2026-05", "2026-06"],
        ["2026-04", "2026-05"],
      ]),
    ).toBe("2026-05");
  });

  test("returns the latest month from a single array", () => {
    expect(selectLatestCommonMonth([["2026-03", "2026-04", "2026-05"]])).toBe("2026-05");
  });

  test("returns null when there is no common month", () => {
    expect(selectLatestCommonMonth([["2026-01"], ["2026-02"]])).toBeNull();
  });

  test("returns null for an empty input", () => {
    expect(selectLatestCommonMonth([])).toBeNull();
  });

  test("handles arrays in any order", () => {
    expect(
      selectLatestCommonMonth([
        ["2026-02", "2026-04", "2026-01"],
        ["2026-03", "2026-04"],
      ]),
    ).toBe("2026-04");
  });
});
