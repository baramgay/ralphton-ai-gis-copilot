"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

export type PanelLayout = {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

export const PANEL_LAYOUT_STORAGE_KEY = "ralphton-panel-layout-v1";

export const PANEL_DEFAULTS: PanelLayout = {
  left: 300,
  right: 360,
  leftCollapsed: false,
  rightCollapsed: false,
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

  useEffect(() => {
    const stored = fitToViewport(readStoredLayout(), window.innerWidth);
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
  };
}
