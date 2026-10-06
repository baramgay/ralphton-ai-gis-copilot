"use client";

import { useId, useState } from "react";

export type AnalysisMethodPreset = {
  id: string;
  label: string;
  subtitle: string;
  query: string;
};

export type AnalysisMethodsProps = {
  trendPresets: readonly AnalysisMethodPreset[];
  crossPresets: readonly (AnalysisMethodPreset & { group: string })[];
  crossGroups: readonly string[];
  onTrend: (query: string) => void;
  onCross: (query: string) => void;
};

const METHODS = [
  { id: "current", label: "현재 수준" },
  { id: "trend", label: "변화 보기" },
  { id: "cross", label: "함께 보기" },
] as const;

function PresetRow({ preset, kind, onChoose }: {
  preset: AnalysisMethodPreset;
  kind: "trend" | "cross";
  onChoose: (query: string) => void;
}) {
  return <button
    type="button"
    className="analysis-method-row"
    data-testid={`${kind}-${preset.id}`}
    aria-label={preset.label}
    onClick={() => onChoose(preset.query)}
  >
    <span className="analysis-method-row-copy">
      <span className="analysis-method-row-label">{preset.label}</span>
      <span className="analysis-method-row-subtitle">{preset.subtitle}</span>
    </span>
    <span className="analysis-method-row-arrow" aria-hidden="true">→</span>
  </button>;
}

export function AnalysisMethods({ trendPresets, crossPresets, crossGroups, onTrend, onCross }: AnalysisMethodsProps) {
  const [method, setMethod] = useState<typeof METHODS[number]["id"]>("current");
  const headingId = useId();

  return <section className="analysis-method-panel" aria-labelledby={headingId} data-testid="analysis-methods">
    <h2 id={headingId} className="analysis-method-heading">다음 분석 고르기</h2>
    <p className="analysis-method-description">종류를 고른 뒤 추천 항목을 누르면 새 분석을 실행합니다.</p>
    <div role="group" aria-label="분석 추천 유형" className="analysis-method-options">
      {METHODS.map((item) => <button
        key={item.id}
        type="button"
        className="analysis-method-option"
        aria-pressed={method === item.id}
        onClick={() => setMethod(item.id)}
      >{item.label}</button>)}
    </div>

    {method === "current" ? <p className="analysis-method-description">위의 자료와 지표를 선택하면 해당 시점의 지역 순위를 분석합니다.</p> : null}

    {method === "trend" ? <section className="analysis-method-content" data-testid="trend-presets" aria-label="시간에 따른 변화">
      <h3 className="analysis-method-content-heading">시간에 따른 변화</h3>
      <p className="analysis-method-description">한 시점의 크기보다, 그동안 얼마나 달라졌는지 확인합니다.</p>
      <div className="analysis-method-list">{trendPresets.map((preset) => <PresetRow key={preset.id} preset={preset} kind="trend" onChoose={onTrend} />)}</div>
    </section> : null}

    {method === "cross" ? <section className="analysis-method-content" data-testid="cross-presets" aria-label="두 자료를 겹쳐 보기">
      <h3 className="analysis-method-content-heading">두 자료를 겹쳐 보기</h3>
      <p className="analysis-method-description">사람·소비·소득 등 서로 다른 자료를 나란히 분석합니다.</p>
      {crossGroups.map((group) => {
        const presets = crossPresets.filter((preset) => preset.group === group);
        if (!presets.length) return null;
        return <div key={group} className="analysis-method-group">
          <h4 className="analysis-method-group-heading">{group}</h4>
          <div className="analysis-method-list">{presets.map((preset) => <PresetRow key={preset.id} preset={preset} kind="cross" onChoose={onCross} />)}</div>
        </div>;
      })}
    </section> : null}
  </section>;
}
