import type { AnalysisResult } from "@/lib/analysis/result";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

export type Interpretation = {
  headline: string;
  insights: string[];
  suggestions: string[];
  caveats: string[];
};

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "데이터 없음";
  }
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
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

  const insights: string[] = [];
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
          return `${index + 1}위 ${region.adm_nm.replace("부산광역시 ", "")}(${scoreLabel})`;
        })
        .join(", ")}.`,
    );
  } else if (medicalFacilities.length > 0) {
    insights.push(`조건에 맞는 의료기관 ${medicalFacilities.length}곳을 지도에 표시했습니다.`);
  } else {
    insights.push("표시할 순위 또는 시설이 없습니다. 조건을 완화해 보세요.");
  }

  if (selected) {
    const metric = selected.metrics[0];
    insights.push(
      `선택 지역 ${selected.adm_nm.replace("부산광역시 ", "")}: ${
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
    "빠른 분석 ‘고령 인구 × 의료 부족’과 ‘2km 접근성’을 교차 확인해 수요·공급 격차를 비교하세요.",
    "기장군 vs 강서구 비교 후 상위 행정동을 클릭하면 13개월 추세와 산식을 함께 볼 수 있습니다.",
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

  return {
    headline: result.title ? `${result.title} — 해석 요약` : "분석 해석",
    insights,
    suggestions: suggestions.slice(0, 3),
    caveats: caveats.filter(Boolean).slice(0, 5),
  };
}
