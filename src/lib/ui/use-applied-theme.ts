"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_THEME, readAppliedTheme, resolveTheme, subscribeAppliedTheme } from "./theme";
import type { ResolvedTheme } from "./theme";

/**
 * 적용된 테마를 구독한다.
 *
 * `useSyncExternalStore`를 쓰는 이유는 서버 스냅샷을 따로 줄 수 있어서다 — 서버는
 * `<html data-theme>`을 모르므로 기본 테마로 그리고, 붙는 순간 실제 값으로 맞춘다.
 * `useEffect`로 하면 첫 프레임에 밝은 색띠가 한 번 지나간다.
 */
export function useAppliedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeAppliedTheme, readAppliedTheme, () =>
    resolveTheme(DEFAULT_THEME),
  );
}
