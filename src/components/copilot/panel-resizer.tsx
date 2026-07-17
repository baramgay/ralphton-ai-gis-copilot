"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PanelResizerProps = {
  side: "left" | "right";
  width: number;
  disabled?: boolean;
  onResize: (width: number) => void;
  onReset?: () => void;
  label: string;
};

/**
 * Drag handle between sidebar and map.
 * - Drag: resize
 * - Double-click / Home / Enter: reset layout (parent onReset)
 * - Arrow keys: ±16px (Shift ±32px)
 */
export function PanelResizer({
  side,
  width,
  disabled = false,
  onResize,
  onReset,
  label,
}: PanelResizerProps) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const applyPointer = useCallback(
    (clientX: number) => {
      if (side === "left") {
        onResize(clientX);
        return;
      }
      onResize(window.innerWidth - clientX);
    },
    [onResize, side],
  );

  useEffect(() => {
    if (!active) return;

    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      applyPointer(event.clientX);
    };
    const onUp = () => {
      dragging.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [active, applyPointer]);

  if (disabled) {
    return <div className="panel-resizer panel-resizer-disabled" aria-hidden />;
  }

  return (
    <div
      className={`panel-resizer ${active ? "is-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={200}
      aria-valuemax={600}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        setActive(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        applyPointer(event.clientX);
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 16;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResize(side === "left" ? width - step : width + step);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onResize(side === "left" ? width + step : width - step);
        } else if (event.key === "Home" || event.key === "Enter") {
          event.preventDefault();
          onReset?.();
        }
      }}
    >
      <span className="panel-resizer-grip" aria-hidden />
    </div>
  );
}
