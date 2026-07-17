import { describe, expect, test } from "vitest";

import { MonthSchema } from "@/lib/domain/schemas";

describe("MonthSchema", () => {
  test.each(["2026-01", "2026-06", "2026-12"])("accepts calendar month %s", (month) => {
    expect(MonthSchema.safeParse(month).success).toBe(true);
  });

  test.each(["2026-00", "2026-13", "2025-18", "26-06", "2026-6"])(
    "rejects impossible month %s",
    (month) => {
      expect(MonthSchema.safeParse(month).success).toBe(false);
    },
  );
});
