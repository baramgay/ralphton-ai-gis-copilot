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

/**
 * 아무것도 고르지 않았을 때의 테마.
 *
 * 이 도구는 지도와 단계구분·차트가 화면의 대부분이다. 어두운 바탕에서 색 대비가 커져
 * 단계 차이가 눈에 먼저 들어오고, 회의실 빔프로젝터에서도 흰 화면보다 덜 번진다.
 * 시스템 설정을 따르면 사람마다 다른 화면을 보게 되어 같은 자료를 두고 이야기하기
 * 어렵다 — 기본을 하나로 고정하고, 바꾸고 싶은 사람은 테마 단추로 바꾼다.
 *
 * ⚠️ 첫 페인트 전에 도는 `THEME_BOOTSTRAP_SCRIPT`의 기본값과 **반드시 같아야 한다.**
 * 어긋나면 흰 화면이 한 번 번쩍인 뒤 어두워진다.
 */
export const DEFAULT_THEME: ThemePreference = "dark";

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
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
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k)||${JSON.stringify(DEFAULT_THEME)};var r=t;if(t==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}if(r==="dark"||r==="contrast"){document.documentElement.dataset.theme=r;}else{delete document.documentElement.dataset.theme;}}catch(e){}})();`;

/**
 * 지금 화면에 적용된 테마를 읽는다(`<html data-theme>`).
 *
 * 색을 CSS 변수로 낼 수 있는 곳은 CSS에서 끝내는 게 낫지만, 지도 색띠는 캔버스·SVG에
 * 문자열로 넘겨야 해서 자바스크립트가 값을 알아야 한다. 테마 단추를 누르면 속성이
 * 바뀌므로 그 변화를 지켜본다 — 한 번만 읽으면 지도만 옛 색으로 남는다.
 *
 * 서버에서는 알 수 없다. 기본 테마를 돌려주고, 붙은 뒤 실제 값으로 맞춘다.
 */
export function readAppliedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return resolveTheme(DEFAULT_THEME);
  const value = document.documentElement.dataset.theme;
  return value === "dark" || value === "contrast" ? value : "light";
}

export function subscribeAppliedTheme(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
