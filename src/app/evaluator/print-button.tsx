"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white"
      onClick={() => window.print()}
    >
      인쇄 (Ctrl+P)
    </button>
  );
}
