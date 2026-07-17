"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep console noise minimal; never surface stack traces in UI.
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <section
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl"
        role="alert"
        aria-labelledby="app-error-title"
      >
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">
          !
        </div>
        <h1 id="app-error-title" className="text-lg font-bold text-slate-950">
          화면을 다시 준비해야 합니다
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          일시적인 오류가 발생했습니다. 데이터나 지도 연결을 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
        >
          다시 시도
        </button>
      </section>
    </main>
  );
}
