import type { AnalysisResult } from "@/lib/analysis/result";
import { countBySido, stripSido } from "@/lib/analysis/scope";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";
import { enrichInterpretationWithRag } from "@/lib/rag/augment";

export type Interpretation = {
  headline: string;
  insights: string[];
  suggestions: string[];
  caveats: string[];
  ragCitations?: Array<{ id: string; title: string }>;
};

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "데이터 없음";
  }
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}

function shortName(admNm: string): string {
  return stripSido(admNm);
}

/**
 * One-line policy-style takeaway for the result header (no model calls).
 */
export function buildOneLineConclusion(
  result: AnalysisResult,
  options?: { selectedRegionCode?: string | null },
): string {
  const top = result.rankedRegions.slice(0, 3);
  const selected =
    result.rankedRegions.find((region) => region.adm_cd2 === options?.selectedRegionCode) ??
    result.selectedRegion;
  const facilities = result.filteredFacilities.filter((facility) => facility.type !== "약국");

  if (top.length >= 2) {
    const names = top.map((region) => shortName(region.adm_nm));
    const metric = top[0]?.metrics[0];
    const metricHint = metric ? `${metric.label} 기준 ` : "";
    const mix = countBySido(top);
    const mixHint =
      mix.busan > 0 && mix.gyeongnam > 0
        ? ` (부산 ${mix.busan} · 경남 ${mix.gyeongnam})`
        : mix.busan > 0
          ? " (부산)"
          : mix.gyeongnam > 0
            ? " (경남)"
            : "";
    const selectedHint =
      selected && top.some((region) => region.adm_cd2 === selected.adm_cd2)
        ? ` 선택 지역은 ${shortName(selected.adm_nm)}.`
        : "";
    return `${metricHint}상위 ${names.length}곳은 ${names.join(" · ")}${mixHint}입니다.${selectedHint}`;
  }

  if (top.length === 1) {
    const metric = top[0].metrics[0];
    return `${shortName(top[0].adm_nm)}이(가) ${metric ? metric.label : "지표"}에서 가장 두드러집니다.`;
  }

  if (facilities.length > 0) {
    const mix = countBySido(facilities);
    const mixHint =
      mix.busan > 0 || mix.gyeongnam > 0
        ? ` (부산 ${mix.busan} · 경남 ${mix.gyeongnam})`
        : "";
    return `조건에 맞는 의료기관 ${facilities.length}곳${mixHint}을 확인하세요.`;
  }

  return "표시할 순위·시설이 없습니다. 빠른 분석이나 질문을 다시 실행해 보세요.";
}

/**
 * Deterministic analysis interpretation — no model names or provider leakage.
 * Safe offline; does not call external AI.
 */
export function interpretAnalysisResult(
  result: AnalysisResult,
  snapshot: AnalysisSnapshot,
  options?: { selectedRegionCode?: string | null },
): Interpretation {
  const top = result.rankedRegions.slice(0, 3);
  const selected =
    result.rankedRegions.find((region) => region.adm_cd2 === options?.selectedRegionCode) ??
    result.selectedRegion;
  const medicalFacilities = result.filteredFacilities.filter((facility) => facility.type !== "약국");
  const modeLabel = snapshot.mode === "live" ? "실데이터 혼합" : "데모 샘플";
  const conclusion = buildOneLineConclusion(result, options);

  const insights: string[] = [conclusion];
  if (top.length > 0) {
    insights.push(
      `상위 지역: ${top
        .map((region, index) => {
          const metric = region.metrics[0];
          const scoreLabel =
            region.score !== null
              ? formatValue(region.score, "점")
              : metric
                ? formatValue(metric.value, metric.unit)
                : "—";
          return `${index + 1}위 ${shortName(region.adm_nm)}(${scoreLabel})`;
        })
        .join(", ")}.`,
    );
  } else if (medicalFacilities.length > 0) {
    insights.push(`조건에 맞는 의료기관 ${medicalFacilities.length}곳을 지도에 표시했습니다.`);
  }

  if (selected) {
    const metric = selected.metrics[0];
    insights.push(
      `선택 지역 ${shortName(selected.adm_nm)}: ${
        metric
          ? `${metric.label} ${formatValue(metric.value, metric.unit)}`
          : selected.score !== null
            ? `점수 ${formatValue(selected.score, "점")}`
            : "상세 지표 확인"
      }.`,
    );
  }

  insights.push(`기준월 ${snapshot.referenceMonth} · 데이터 모드 ${modeLabel}.`);

  const suggestions: string[] = [
    "빠른 분석 ‘고령 × 의료’와 ‘주변 접근’을 교차 확인해 수요·공급 격차를 비교하세요.",
    "지도 칩으로 부산/경남을 나눈 뒤, 구 비교 → 「동 순위 보기」로 세부 행정동을 확인하세요.",
    "이용 탭의 평가자 가이드 시나리오(3분)로 핵심 기능을 순서대로 점검할 수 있습니다.",
  ];

  if (result.filteredFacilities.some((facility) => facility.hours == null)) {
    suggestions.push("운영시간·진료과 조건은 값이 있는 시설만 필터됩니다. ‘데이터 없음’은 추정하지 않습니다.");
  }

  const caveats = [
    ...result.formulaNotes.slice(0, 3),
    "거리는 대표점 기준 직선거리이며 도로·대중교통 접근성과 다를 수 있습니다.",
    "출생−사망은 자연증가만 포함하며 전입·전출은 반영하지 않습니다.",
    snapshot.mode === "demo"
      ? "현재 화면은 시연용 합성 데이터일 수 있어 정책 판단에 직접 사용하지 마세요."
      : "실데이터 시설과 검증 스냅샷 인구가 혼합될 수 있습니다. 출처 탭에서 한계를 확인하세요.",
  ];

  const base: Interpretation = {
    headline: result.title ? `${result.title} — 해석 요약` : "분석 해석",
    insights,
    suggestions: suggestions.slice(0, 3),
    caveats: caveats.filter(Boolean).slice(0, 5),
  };

  // Offline RAG: method caveats + next-step suggestions from curated corpus
  return enrichInterpretationWithRag(base, result, result.title);
}
