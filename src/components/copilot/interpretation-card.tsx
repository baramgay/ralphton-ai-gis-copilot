import type { Interpretation } from "@/lib/analysis/interpret";

type InterpretationCardProps = {
  interpretation: Interpretation;
};

export function InterpretationCard({ interpretation }: InterpretationCardProps) {
  return (
    <section
      className="interactive-card rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby="interpretation-title"
      data-testid="interpretation-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-label !mb-1 text-blue-600">한눈에 보기</p>
          <h2 id="interpretation-title" className="ui-title text-slate-950">
            {interpretation.headline}
          </h2>
        </div>
        {interpretation.ragCitations && interpretation.ragCitations.length > 0 ? (
          <span className="ui-chip shrink-0 rounded-full bg-violet-50 px-2.5 py-1 font-bold text-violet-700">
            근거 {interpretation.ragCitations.length}
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <h3 className="ui-caption font-bold text-slate-600">핵심 포인트</h3>
          <ul className="mt-2 space-y-2 ui-body text-slate-700">
            {interpretation.insights.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
          <h3 className="ui-caption font-bold text-emerald-800">다음에 해볼 수 있는 것</h3>
          <ul className="mt-2 space-y-1.5 ui-body text-emerald-950/85">
            {interpretation.suggestions.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>

        <details className="ui-details !border-slate-100 !bg-slate-50/80">
          <summary className="!text-[length:var(--fs-chip)] !text-slate-600">해석 한계 · 주의</summary>
          <ul className="ui-details-body !pt-0 space-y-1.5 ui-chip text-slate-500">
            {interpretation.caveats.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </details>

        {interpretation.ragCitations && interpretation.ragCitations.length > 0 ? (
          <details className="ui-details !border-violet-100 !bg-violet-50/50" data-testid="rag-citations">
            <summary className="!text-[length:var(--fs-chip)] !text-violet-800">근거 지식</summary>
            <ul className="ui-details-body !pt-0 space-y-1 ui-chip text-violet-900/85">
              {interpretation.ragCitations.map((cite) => (
                <li key={cite.id}>
                  · <span className="font-semibold">{cite.title}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
