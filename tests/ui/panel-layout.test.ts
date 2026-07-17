import { describe, expect, test } from "vitest";

import { PANEL_DEFAULTS, PANEL_LIMITS } from "@/components/copilot/use-panel-layout";

describe("panel layout defaults", () => {
  test("keeps map-friendly default widths", () => {
    expect(PANEL_DEFAULTS.left).toBeGreaterThanOrEqual(PANEL_LIMITS.leftMin);
    expect(PANEL_DEFAULTS.right).toBeGreaterThanOrEqual(PANEL_LIMITS.rightMin);
    expect(PANEL_DEFAULTS.left + PANEL_DEFAULTS.right + PANEL_LIMITS.resizer * 2).toBeLessThan(
      1280 - PANEL_LIMITS.mapMin,
    );
  });

  test("limits are ordered", () => {
    expect(PANEL_LIMITS.leftMin).toBeLessThan(PANEL_LIMITS.leftMax);
    expect(PANEL_LIMITS.rightMin).toBeLessThan(PANEL_LIMITS.rightMax);
    expect(PANEL_LIMITS.mapMin).toBeGreaterThan(200);
  });
});
