import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyResolvedTheme,
  cycleThemePreference,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/ui/theme";

describe("theme helpers", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it("validates preference values", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
  });

  it("cycles system → light → dark → contrast", () => {
    expect(cycleThemePreference("system")).toBe("light");
    expect(cycleThemePreference("light")).toBe("dark");
    expect(cycleThemePreference("dark")).toBe("contrast");
    expect(cycleThemePreference("contrast")).toBe("system");
  });

  it("resolves system via matchMedia", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("contrast")).toBe("contrast");
  });

  it("applies data-theme for dark/contrast and clears for light", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyResolvedTheme("contrast");
    expect(document.documentElement.dataset.theme).toBe("contrast");
    applyResolvedTheme("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("uses stable storage key", () => {
    expect(THEME_STORAGE_KEY).toBe("ralphton-theme");
  });
});
