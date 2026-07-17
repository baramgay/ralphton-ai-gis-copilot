/**
 * Theme preference: light / dark / contrast / system (OS prefers-color-scheme).
 */

export type ThemePreference = "light" | "dark" | "contrast" | "system";
export type ResolvedTheme = "light" | "dark" | "contrast";

export const THEME_STORAGE_KEY = "ralphton-theme";

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "라이트",
  dark: "다크",
  contrast: "고대비",
  system: "시스템",
};

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "contrast" || value === "system";
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "system";
}

export function storeTheme(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

/** Apply resolved theme to <html data-theme>. Light clears the attribute. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  if (resolved === "light") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = resolved;
  }
}

export function cycleThemePreference(current: ThemePreference): ThemePreference {
  const order: ThemePreference[] = ["system", "light", "dark", "contrast"];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? "system";
}

/** Inline bootstrap for layout — prevents light flash before React hydrates. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k)||"system";var r=t;if(t==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}if(r==="dark"||r==="contrast"){document.documentElement.dataset.theme=r;}else{delete document.documentElement.dataset.theme;}}catch(e){}})();`;
