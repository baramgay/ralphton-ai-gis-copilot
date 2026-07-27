"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

export type PanelLayout = {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

// v1은 질의창이 왼쪽 패널에 있던 시절의 기본값이라, 그때 저장된 배치를 그대로 복원하면
// 새 기본(왼쪽 접힘)이 적용되지 않는다. 배치의 의미가 바뀌었으므로 키를 올린다.
export const PANEL_LAYOUT_STORAGE_KEY = "ralphton-panel-layout-v2";

export const PANEL_DEFAULTS: PanelLayout = {
  left: 300,
  right: 360,
  /*
   * 왼쪽은 기본으로 접는다. 질의창이 지도 위 히어로로 올라가면서 이 패널에 남은 것은
   * "직접 고르기"(레이어·지표·단위·프리셋)뿐이다 — 처음 열었을 때 필요한 것이 아니라,
   * 자연어로 안 되는 것을 손으로 할 때 필요한 것이다. 지도에 자리를 내준다.
   */
  leftCollapsed: true,
  rightCollapsed: false,
};

export type LayoutPresetId = "balanced" | "map" | "analyze" | "results";

export const LAYOUT_PRESETS: Record<
  LayoutPresetId,
  { label: string; layout: PanelLayout; hint: string }
> = {
  balanced: {
    label: "균형",
    hint: "조작·지도·결과 균등",
    // 기본값을 그대로 쓰면 왼쪽이 접힌 채로 "균형"이 된다. 이 프리셋은 셋을 다 보이는 뜻이다.
    layout: { ...PANEL_DEFAULTS, leftCollapsed: false, rightCollapsed: false },
  },
  map: {
    label: "지도 넓게",
    hint: "양쪽 패널 접기",
    layout: { left: 300, right: 360, leftCollapsed: true, rightCollapsed: true },
  },
  analyze: {
    label: "분석 집중",
    hint: "왼쪽 넓게 · 결과 좁게",
    layout: { left: 360, right: 280, leftCollapsed: false, rightCollapsed: false },
  },
  results: {
    label: "결과 집중",
    hint: "오른쪽 넓게 · 조작 좁게",
    layout: { left: 240, right: 440, leftCollapsed: false, rightCollapsed: false },
  },
};

export const PANEL_LIMITS = {
  leftMin: 220,
  leftMax: 480,
  rightMin: 260,
  rightMax: 560,
  mapMin: 280,
  resizer: 6,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredLayout(): PanelLayout {
  if (typeof window === "undefined") return PANEL_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) return PANEL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      left: clamp(Number(parsed.left) || PANEL_DEFAULTS.left, PANEL_LIMITS.leftMin, PANEL_LIMITS.leftMax),
      right: clamp(
        Number(parsed.right) || PANEL_DEFAULTS.right,
        PANEL_LIMITS.rightMin,
        PANEL_LIMITS.rightMax,
      ),
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return PANEL_DEFAULTS;
  }
}

function fitToViewport(layout: PanelLayout, viewportWidth: number): PanelLayout {
  const chrome = PANEL_LIMITS.resizer * 2;
  const left = layout.leftCollapsed ? 0 : layout.left;
  const right = layout.rightCollapsed ? 0 : layout.right;
  const mapSpace = viewportWidth - left - right - chrome;
  if (mapSpace >= PANEL_LIMITS.mapMin) return layout;

  // Shrink panels proportionally so the map keeps a usable width.
  let nextLeft = left;
  let nextRight = right;
  let deficit = PANEL_LIMITS.mapMin - mapSpace;
  if (nextLeft > 0 && nextRight > 0) {
    const half = Math.ceil(deficit / 2);
    nextLeft = Math.max(PANEL_LIMITS.leftMin, nextLeft - half);
    deficit -= left - nextLeft;
    nextRight = Math.max(PANEL_LIMITS.rightMin, nextRight - deficit);
  } else if (nextLeft > 0) {
    nextLeft = Math.max(PANEL_LIMITS.leftMin, nextLeft - deficit);
  } else if (nextRight > 0) {
    nextRight = Math.max(PANEL_LIMITS.rightMin, nextRight - deficit);
  }

  return {
    ...layout,
    left: layout.leftCollapsed ? layout.left : nextLeft,
    right: layout.rightCollapsed ? layout.right : nextRight,
  };
}

export function usePanelLayout() {
  const [layout, setLayout] = useState<PanelLayout>(PANEL_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  /*
   * 저장된 배치는 localStorage에, 화면 폭은 window에 있다. 둘 다 서버에 없으므로 렌더 중
   * (또는 useState 초기값)에 읽으면 서버가 그린 것과 달라져 하이드레이션이 깨진다.
   * 마운트 뒤 한 번 맞추는 것이 유일한 방법이다.
   */
  useEffect(() => {
    const stored = fitToViewport(readStoredLayout(), window.innerWidth);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [hydrated, layout]);

  useEffect(() => {
    if (!hydrated) return;
    const onResize = () => {
      setLayout((previous) => fitToViewport(previous, window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hydrated]);

  const setLeftWidth = useCallback((width: number) => {
    setLayout((previous) => {
      const next = {
        ...previous,
        left: clamp(width, PANEL_LIMITS.leftMin, PANEL_LIMITS.leftMax),
        leftCollapsed: false,
      };
      return fitToViewport(next, window.innerWidth);
    });
  }, []);

  const setRightWidth = useCallback((width: number) => {
    setLayout((previous) => {
      const next = {
        ...previous,
        right: clamp(width, PANEL_LIMITS.rightMin, PANEL_LIMITS.rightMax),
        rightCollapsed: false,
      };
      return fitToViewport(next, window.innerWidth);
    });
  }, []);

  const toggleLeft = useCallback(() => {
    setLayout((previous) => ({ ...previous, leftCollapsed: !previous.leftCollapsed }));
  }, []);

  const toggleRight = useCallback(() => {
    setLayout((previous) => ({ ...previous, rightCollapsed: !previous.rightCollapsed }));
  }, []);

  const expandMap = useCallback(() => {
    setLayout((previous) => ({
      ...previous,
      leftCollapsed: true,
      rightCollapsed: true,
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(fitToViewport(PANEL_DEFAULTS, window.innerWidth));
  }, []);

  const applyPreset = useCallback((id: LayoutPresetId) => {
    const preset = LAYOUT_PRESETS[id];
    setLayout(fitToViewport({ ...preset.layout }, window.innerWidth));
  }, []);

  const cssVars = {
    "--panel-left": layout.leftCollapsed ? "0px" : `${layout.left}px`,
    "--panel-right": layout.rightCollapsed ? "0px" : `${layout.right}px`,
  } as CSSProperties;

  return {
    layout,
    hydrated,
    cssVars,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    expandMap,
    resetLayout,
    applyPreset,
  };
}
