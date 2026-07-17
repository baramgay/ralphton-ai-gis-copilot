import type { Interpretation } from "@/lib/analysis/interpret";

type InterpretationCardProps = {
  interpretation: Interpretation;
};

export function InterpretationCard({ interpretation }: InterpretationCardProps) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby="interpretation-title"
      data-testid="interpretation-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-blue-600">분석 해석</p>
          <h2 id="interpretation-title" className="mt-1 text-[14px] font-bold text-slate-950">
            {interpretation.headline}
          </h2>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <h3 className="text-[10px] font-bold text-slate-600">핵심 요약</h3>
          <ul className="mt-1.5 space-y-1.5 text-[11px] leading-5 text-slate-600">
            {interpretation.insights.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
          <h3 className="text-[10px] font-bold text-emerald-800">개선 제안</h3>
          <ul className="mt-1.5 space-y-1.5 text-[11px] leading-5 text-emerald-900/80">
            {interpretation.suggestions.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>

        <details className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
          <summary className="cursor-pointer text-[10px] font-bold text-slate-600">해석 한계 · 주의</summary>
          <ul className="mt-2 space-y-1.5 text-[10px] leading-5 text-slate-500">
            {interpretation.caveats.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
