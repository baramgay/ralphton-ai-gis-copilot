export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#e7edf3]" aria-busy="true" aria-live="polite">
      <div className="w-full max-w-sm px-6">
        <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-lg">
          <div className="mb-4 h-3 w-24 animate-pulse rounded-full bg-slate-200 motion-reduce:animate-none" />
          <div className="mb-2 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
          <div className="mb-6 h-3 w-full animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
          </div>
          <p className="mt-5 text-center text-sm font-medium text-slate-600">부산 공간 데이터를 준비하는 중…</p>
        </div>
      </div>
    </main>
  );
}
