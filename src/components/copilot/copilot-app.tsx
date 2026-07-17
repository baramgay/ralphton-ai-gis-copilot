"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import { interpretAnalysisResult } from "@/lib/analysis/interpret";
import type { AnalysisResult, MetricDescriptor } from "@/lib/analysis/result";
import { executeAnalysisIntent } from "@/lib/analysis/tool-registry";
import { InterpretationCard } from "./interpretation-card";
import { MapCanvas } from "./map-canvas";
import { TrendChart } from "./trend-chart";
import type { AnalysisSnapshot, BoundaryCollection, Facility, RegionSeries } from "./types";

type TabId = "analysis" | "help" | "data";
type QuickId =
  | "scarcity"
  | "elderly"
  | "growth"
  | "nearest"
  | "radius"
  | "compare"
  | "facilities"
  | "reset";

type RankedRegion = {
  code: string;
  name: string;
  district: string;
  mapScore: number;
  valueLabel: string;
  note: string;
  metrics: MetricDescriptor[];
};
type AnalysisView = {
  id: QuickId;
  title: string;
  summary: string;
  ranked: RankedRegion[];
  filteredFacilities: Facility[];
  formulaNotes: string[];
  legendLabel: string;
  isFacilityResult: boolean;
};

type CopilotAppProps = {
  boundaryVersion: string;
  kakaoMapKey?: string;
};

const QUICK_ANALYSES: Array<{
  id: QuickId;
  label: string;
  subtitle: string;
  symbol: string;
  tone: string;
}> = [
  { id: "scarcity", label: "의료 취약 지역", subtitle: "공급 부족 종합점수", symbol: "+", tone: "bg-rose-50 text-rose-600" },
  { id: "elderly", label: "고령 인구 × 의료 부족", subtitle: "고령 수요 대비 공급", symbol: "◎", tone: "bg-violet-50 text-violet-600" },
  { id: "growth", label: "인구 증가 × 공급 부족", subtitle: "12개월 수요 압력", symbol: "↗", tone: "bg-emerald-50 text-emerald-600" },
  { id: "nearest", label: "최근접 의료기관 거리", subtitle: "대표점 직선거리", symbol: "⌖", tone: "bg-sky-50 text-sky-600" },
  { id: "radius", label: "2km 접근성", subtitle: "반경 내 의료기관", symbol: "◉", tone: "bg-blue-50 text-blue-600" },
  { id: "compare", label: "기장군 vs 강서구", subtitle: "동 단위 지표 비교", symbol: "⇄", tone: "bg-amber-50 text-amber-700" },
  { id: "facilities", label: "전체 의료기관", subtitle: "약국 제외 시설 표시", symbol: "◆", tone: "bg-cyan-50 text-cyan-700" },
  { id: "reset", label: "초기화", subtitle: "첫 화면으로 돌아가기", symbol: "↺", tone: "bg-slate-100 text-slate-600" },
];

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "analysis", label: "분석" },
  { id: "help", label: "이용방법" },
  { id: "data", label: "데이터 정보" },
];

function compactName(region: RegionSeries): string {
  return region.adm_nm.replace("부산광역시 ", "");
}

function quickIntent(id: QuickId, radiusKm: 1 | 2 | 3, regionLimit: number): AnalysisIntent {
  const limit = Math.max(1, Math.min(regionLimit, 250));
  const intents: Record<QuickId, AnalysisIntent> = {
    scarcity: { tool: "rankHospitalScarcity", filters: { limit } },
    elderly: { tool: "rankElderlyUnderserved", filters: { limit } },
    growth: { tool: "rankPopulationGrowthPressure", filters: { limit } },
    nearest: { tool: "nearestFacilityDistance", filters: { limit } },
    radius: { tool: "countFacilitiesWithinRadius", filters: { radiusKm, limit } },
    compare: { tool: "compareRegions", filters: { compare: ["기장군", "강서구"] } },
    facilities: { tool: "filterFacilitiesByTypeAndHours", filters: {} },
    reset: { tool: "rankHospitalScarcity", filters: { limit } },
  };
  return intents[id];
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "데이터 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}

function resultToView(
  id: QuickId,
  result: AnalysisResult,
  titleOverride?: string,
): AnalysisView {
  const isFacilityResult = id === "facilities";
  const source = result.rankedRegions.length > 0 || isFacilityResult
    ? result.rankedRegions
    : result.selectedRegion
      ? [result.selectedRegion]
      : [];
  const values = source.map((region) => region.score ?? region.metrics[0]?.value ?? null);
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const minimum = finite.length ? Math.min(...finite) : 0;
  const maximum = finite.length ? Math.max(...finite) : 1;
  const span = Math.max(1, maximum - minimum);
  const ranked = source.map((region): RankedRegion => {
    const primaryMetric = region.metrics[0];
    const rawValue = region.score ?? primaryMetric?.value ?? null;
    const mapScore = rawValue === null
      ? 0
      : finite.length <= 1
        ? 50
        : ((rawValue - minimum) / span) * 100;
    return {
      code: region.adm_cd2,
      name: region.adm_nm.replace("부산광역시 ", ""),
      district: region.adm_nm.split(" ")[1] ?? "부산",
      mapScore,
      valueLabel: primaryMetric
        ? formatMetric(primaryMetric.value, primaryMetric.unit)
        : region.score === null
          ? "데이터 없음"
          : formatMetric(region.score, "점"),
      note: primaryMetric ? `${primaryMetric.label} · ${formatMetric(primaryMetric.value, primaryMetric.unit)}` : "상세 지표",
      metrics: region.metrics,
    };
  });

  return {
    id,
    title: titleOverride ?? result.title,
    summary: result.summary,
    ranked,
    filteredFacilities: result.filteredFacilities,
    formulaNotes: result.formulaNotes,
    legendLabel: `${titleOverride ?? result.title} 상대 분포`,
    isFacilityResult,
  };
}

function executeQuickAnalysis(snapshot: AnalysisSnapshot, id: QuickId, radiusKm: 1 | 2 | 3): AnalysisView {
  const result = executeAnalysisIntent(quickIntent(id, radiusKm, snapshot.regions.length), snapshot);
  return resultToView(id, result, id === "facilities" ? "전체 의료기관" : undefined);
}

function modeBadgeLabel(mode: AnalysisSnapshot["mode"]): string {
  return mode === "live" ? "실데이터" : "데모";
}

function toolToQuickId(tool: string): QuickId {
  const map: Record<string, QuickId> = {
    rankHospitalScarcity: "scarcity",
    rankElderlyUnderserved: "elderly",
    rankPopulationGrowthPressure: "growth",
    rankPopulationDeclineRisk: "growth",
    rankSingleHouseholdRisk: "scarcity",
    filterFacilitiesByTypeAndHours: "facilities",
    compareRegions: "compare",
    nearestFacilityDistance: "nearest",
    countFacilitiesWithinRadius: "radius",
    getRegionDetails: "scarcity",
  };
  return map[tool] ?? "scarcity";
}

export function CopilotApp({ boundaryVersion, kakaoMapKey = "" }: CopilotAppProps) {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [boundary, setBoundary] = useState<BoundaryCollection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string>("loading");
  const [activeTab, setActiveTab] = useState<TabId>("analysis");
  const [activeQuick, setActiveQuick] = useState<QuickId>("scarcity");
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<1 | 2 | 3>(2);
  const [query, setQuery] = useState("");
  const [queryNotice, setQueryNotice] = useState<string | null>(null);
  const [queryNoticeTone, setQueryNoticeTone] = useState<"neutral" | "error" | "success">("neutral");
  const [isParsing, setIsParsing] = useState(false);
  const [customAnalysis, setCustomAnalysis] = useState<AnalysisView | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/data/snapshot?mode=auto", { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("데모 데이터를 불러오지 못했습니다.");
        setDataSource(response.headers.get("x-data-source") ?? "unknown");
        return response.json() as Promise<AnalysisSnapshot>;
      }),
      fetch(`/data/busan-administrative-dong-${boundaryVersion}.geojson`, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("행정동 경계를 불러오지 못했습니다.");
        return response.json() as Promise<BoundaryCollection>;
      }),
    ])
      .then(([nextSnapshot, nextBoundary]) => {
        setSnapshot(nextSnapshot);
        setBoundary(nextBoundary);
        const initial = executeQuickAnalysis(nextSnapshot, "scarcity", 2);
        setSelectedRegionCode(initial.ranked[0]?.code ?? nextSnapshot.regions[0]?.adm_cd2 ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "데이터 로드 중 오류가 발생했습니다.");
      });
    return () => controller.abort();
  }, [boundaryVersion]);

  const analysis = useMemo(
    () => customAnalysis ?? (snapshot ? executeQuickAnalysis(snapshot, activeQuick, radiusKm) : null),
    [snapshot, activeQuick, radiusKm, customAnalysis],
  );

  const interpretation = useMemo(() => {
    if (!snapshot || !analysis) return null;
    const rankedRegions = analysis.ranked.map((row, index) => {
      const region = snapshot.regions.find((item) => item.adm_cd2 === row.code);
      return {
        adm_cd2: row.code,
        adm_nm: region?.adm_nm ?? row.name,
        representativePoint: region?.representativePoint ?? { lat: 0, lng: 0 },
        areaSquareKm: region?.areaSquareKm ?? 1,
        rank: index + 1,
        score: row.mapScore,
        metrics: row.metrics,
      };
    });
    const result: AnalysisResult = {
      title: analysis.title,
      summary: analysis.summary,
      rankedRegions,
      selectedRegion: rankedRegions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null,
      filteredFacilities: analysis.filteredFacilities,
      legend: [],
      formulaNotes: analysis.formulaNotes,
    };
    return interpretAnalysisResult(result, snapshot, { selectedRegionCode });
  }, [snapshot, analysis, selectedRegionCode]);

  const scores = useMemo(
    () => new Map(analysis?.ranked.map((row) => [row.code, row.mapScore]) ?? []),
    [analysis],
  );
  const selectedRegion = snapshot?.regions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null;
  const defaultMedicalFacilities = snapshot?.facilities.filter((facility) => facility.type !== "약국") ?? [];
  const mapFacilities = analysis?.isFacilityResult
    ? analysis.filteredFacilities
    : (analysis?.filteredFacilities.length ?? 0) > 0
      ? analysis?.filteredFacilities ?? []
      : defaultMedicalFacilities;
  const selectedFacilities = mapFacilities.filter((facility) => facility.adm_cd2 === selectedRegionCode);
  const selectedFacility = analysis?.filteredFacilities.find((facility) => facility.id === selectedFacilityId) ?? null;
  const selectedAnalysisRegion = analysis?.ranked.find((region) => region.code === selectedRegionCode) ?? null;

  const selectFacility = useCallback((facility: Facility) => {
    setSelectedFacilityId(facility.id);
    setSelectedRegionCode(facility.adm_cd2);
  }, []);

  const selectRegion = useCallback((code: string) => {
    setSelectedFacilityId(null);
    setSelectedRegionCode(code);
  }, []);

  const runQuick = useCallback((id: QuickId) => {
    if (id === "reset") {
      setActiveQuick("scarcity");
      const next = snapshot ? executeQuickAnalysis(snapshot, "scarcity", 2) : null;
      setSelectedRegionCode(next?.ranked[0]?.code ?? snapshot?.regions[0]?.adm_cd2 ?? null);
      setRadiusKm(2);
      setQuery("");
      setQueryNotice(null);
      setQueryNoticeTone("neutral");
      setCustomAnalysis(null);
      setSelectedFacilityId(null);
      return;
    }
    setActiveQuick(id);
    setCustomAnalysis(null);
    setSelectedFacilityId(null);
    const next = snapshot ? executeQuickAnalysis(snapshot, id, radiusKm) : null;
    if (next?.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
    else if (next?.filteredFacilities[0]) {
      setSelectedRegionCode(next.filteredFacilities[0].adm_cd2);
      setSelectedFacilityId(next.filteredFacilities[0].id);
    }
    setActiveTab("analysis");
  }, [radiusKm, snapshot]);

  const runRadius = useCallback((radius: 1 | 2 | 3) => {
    setRadiusKm(radius);
    setActiveQuick("radius");
    setCustomAnalysis(null);
    setSelectedFacilityId(null);
    const next = snapshot ? executeQuickAnalysis(snapshot, "radius", radius) : null;
    setSelectedRegionCode(next?.ranked[0]?.code ?? selectedRegionCode);
    setActiveTab("analysis");
  }, [selectedRegionCode, snapshot]);

  const submitQuery = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsParsing(true);
    setQueryNotice(null);
    setQueryNoticeTone("neutral");
    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await response.json() as { intent?: AnalysisIntent | null; notice?: string };
      if (!response.ok || !data.intent?.tool) {
        setQueryNotice(data.notice ?? "질의를 분석하지 못했습니다. 빠른 분석을 선택해 주세요.");
        setQueryNoticeTone("error");
        return;
      }
      if (data.intent.filters?.radiusKm && [1, 2, 3].includes(data.intent.filters.radiusKm)) {
        setRadiusKm(data.intent.filters.radiusKm as 1 | 2 | 3);
      }
      if (!snapshot) return;
      const quickId = toolToQuickId(data.intent.tool);
      const exactResult = executeAnalysisIntent(data.intent, snapshot);
      const nextView = resultToView(quickId, exactResult);
      setActiveQuick(quickId);
      setCustomAnalysis(nextView);
      setSelectedFacilityId(exactResult.filteredFacilities[0]?.id ?? null);
      if (exactResult.selectedRegion) setSelectedRegionCode(exactResult.selectedRegion.adm_cd2);
      else if (exactResult.filteredFacilities[0]) setSelectedRegionCode(exactResult.filteredFacilities[0].adm_cd2);
      setActiveTab("analysis");
      setQueryNotice(data.notice ?? "질의를 분석에 반영했습니다.");
      setQueryNoticeTone("success");
    } catch {
      setQueryNotice("오프라인 상태입니다. 빠른 분석은 계속 사용할 수 있습니다.");
      setQueryNoticeTone("error");
    } finally {
      setIsParsing(false);
    }
  };

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-red-50 text-red-600">!</div>
          <h1 className="text-lg font-bold text-slate-950">지도를 준비하지 못했습니다</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
        </section>
      </main>
    );
  }

  if (!snapshot || !boundary || !analysis) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#e7edf3] p-6" aria-busy="true" aria-live="polite">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-lg">
          <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-slate-200 motion-reduce:animate-none" />
          <div className="mb-2 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
          <div className="mb-5 h-3 w-full animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
          </div>
          <p className="mt-5 text-center text-sm font-medium text-slate-600">부산 공간 데이터를 준비하는 중…</p>
        </div>
      </main>
    );
  }

  const latestIndex = snapshot.months.length - 1;
  const currentPopulation = selectedRegion?.population[latestIndex] ?? 0;
  const currentElderly = selectedRegion?.elderlyPopulation[latestIndex] ?? 0;
  const currentNaturalChange = selectedRegion?.naturalChange[latestIndex] ?? 0;
  const currentOnePerson = selectedRegion?.onePersonHouseholds[latestIndex] ?? null;
  const currentRank = analysis.ranked.findIndex((row) => row.code === selectedRegionCode) + 1;

  return (
    <main className="copilot-shell">
      <a href="#copilot-panel-body" className="skip-link">
        분석 패널로 건너뛰기
      </a>
      <aside className={`copilot-panel ${sheetExpanded ? "sheet-expanded" : ""}`} aria-label="AI GIS 분석 패널">
        <button
          type="button"
          className="mobile-sheet-toggle"
          aria-label={sheetExpanded ? "분석 패널 축소" : "분석 패널 확장"}
          aria-expanded={sheetExpanded}
          aria-controls="copilot-panel-body"
          onClick={() => setSheetExpanded((expanded) => !expanded)}
        >
          <span aria-hidden="true" />
        </button>
        <div className="mobile-sheet-meta" aria-hidden={false}>
          <span className="truncate text-[12px] font-bold text-slate-800">{analysis.title}</span>
          <span className="shrink-0 text-[10px] font-semibold text-slate-500">
            {modeBadgeLabel(snapshot.mode)} · {snapshot.referenceMonth}
          </span>
        </div>
        <header className="border-b border-slate-200/80 px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-blue-600 text-sm font-black text-white shadow-sm">G</span>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-bold tracking-tight text-slate-950">부산 AI GIS Copilot</h1>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                  의료 · 인구 접근성 · 기준월 {snapshot.referenceMonth}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge
                variant="secondary"
                className={`border text-[10px] ${
                  snapshot.mode === "live"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {modeBadgeLabel(snapshot.mode)}
              </Badge>
              <span className="max-w-[7.5rem] truncate text-[9px] text-slate-400" title={dataSource}>
                {dataSource === "supabase-cache"
                  ? "캐시"
                  : dataSource === "demo-fallback"
                    ? "데모 폴백"
                    : dataSource === "demo"
                      ? "로컬 데모"
                      : "데이터 연결"}
              </span>
            </div>
          </div>
        </header>

        <nav className="px-4 pt-3" aria-label="분석 패널 탭">
          <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1" role="tablist">
            {TABS.map(({ id, label }, index) => (
              <button
                key={id}
                id={`copilot-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls="copilot-panel-body"
                tabIndex={activeTab === id ? 0 : -1}
                className={`rounded-[9px] px-2 py-2 text-xs font-semibold transition-all active:scale-[.98] motion-reduce:transition-none ${activeTab === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                onClick={() => setActiveTab(id)}
                onKeyDown={(event) => {
                  const keyOffsets: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
                  let nextIndex = index;
                  if (event.key === "Home") nextIndex = 0;
                  else if (event.key === "End") nextIndex = TABS.length - 1;
                  else if (event.key in keyOffsets) nextIndex = (index + keyOffsets[event.key] + TABS.length) % TABS.length;
                  else return;
                  event.preventDefault();
                  const next = TABS[nextIndex];
                  setActiveTab(next.id);
                  requestAnimationFrame(() => document.getElementById(`copilot-tab-${next.id}`)?.focus());
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div
          id="copilot-panel-body"
          className="copilot-scroll"
          role="tabpanel"
          aria-labelledby={`copilot-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === "analysis" ? (
            <div className="space-y-5 px-4 pb-8 pt-4">
              <section aria-labelledby="query-title">
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 id="query-title" className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">AI에게 질문</h2>
                  <span className="text-[10px] text-slate-400">안전한 로컬 폴백 지원</span>
                </div>
                <form className="relative" onSubmit={submitQuery}>
                  <label htmlFor="analysis-query" className="sr-only">분석 질의</label>
                  <input
                    id="analysis-query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="예: 고령 인구 대비 병원이 부족한 곳"
                    maxLength={1000}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-12 text-[13px] text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="submit"
                    aria-label="질의 실행"
                    disabled={isParsing || !query.trim()}
                    className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-[9px] bg-blue-600 text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {isParsing ? "…" : "↑"}
                  </button>
                </form>
                {queryNotice ? (
                  <p
                    role="status"
                    className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-5 ${
                      queryNoticeTone === "error"
                        ? "bg-rose-50 text-rose-700"
                        : queryNoticeTone === "success"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    {queryNotice}
                  </p>
                ) : null}
              </section>

              <section aria-labelledby="quick-title">
                <h2 id="quick-title" className="mb-2.5 text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">빠른 분석</h2>
                <div className="quick-analysis-grid grid grid-cols-2 gap-2">
                  {QUICK_ANALYSES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`quick-${item.id}`}
                      aria-label={item.label}
                      aria-pressed={activeQuick === item.id && item.id !== "reset"}
                      onPointerDown={() => runQuick(item.id)}
                      onClick={(event) => {
                        if (event.detail === 0) runQuick(item.id);
                      }}
                      className={`group min-h-[70px] min-w-0 rounded-2xl border p-2.5 text-left transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[.985] motion-reduce:transform-none motion-reduce:transition-none ${activeQuick === item.id && item.id !== "reset" ? "border-blue-300 bg-blue-50/55 shadow-sm" : "border-slate-200 bg-white"}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={`grid size-7 shrink-0 place-items-center rounded-[9px] text-sm font-bold ${item.tone}`}>{item.symbol}</span>
                        <span className="min-w-0">
                          <span className="block text-[11px] font-bold leading-4 text-slate-800">{item.label}</span>
                          <span className="mt-1 block text-[9px] leading-3 text-slate-400">{item.subtitle}</span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="result-title">
                <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[.08em] text-blue-600">분석 결과</p>
                      <h2 id="result-title" className="mt-1 text-[15px] font-bold text-slate-950">{analysis.title}</h2>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">
                      {analysis.isFacilityResult ? `${analysis.filteredFacilities.length}개 시설` : `${analysis.ranked.length}개 동`}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-[1.65] text-slate-500">{analysis.summary}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {analysis.isFacilityResult ? (
                    analysis.filteredFacilities.length > 0 ? analysis.filteredFacilities.slice(0, 8).map((facility) => (
                      <button
                        key={facility.id}
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 ${facility.id === selectedFacilityId ? "bg-blue-50/60" : ""}`}
                        onPointerDown={() => selectFacility(facility)}
                        onClick={(event) => {
                          if (event.detail === 0) selectFacility(facility);
                        }}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-cyan-50 text-xs font-black text-cyan-700">+</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-slate-800">{facility.name}</span>
                          <span className="mt-0.5 block text-[10px] text-slate-400">{facility.type} · {facility.adm_nm.replace("부산광역시 ", "")}</span>
                        </span>
                        <span aria-hidden="true" className="text-sm text-slate-300">›</span>
                      </button>
                    )) : (
                      <p className="px-4 py-6 text-center text-[11px] leading-5 text-slate-500">조건에 맞는 시설이 없습니다. 종류나 운영시간 조건을 바꿔 보세요.</p>
                    )
                  ) : analysis.ranked.slice(0, 5).map((row, index) => (
                    <button
                      key={row.code}
                      type="button"
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 ${row.code === selectedRegionCode ? "bg-blue-50/60" : ""}`}
                      onPointerDown={() => selectRegion(row.code)}
                      onClick={(event) => {
                        if (event.detail === 0) selectRegion(row.code);
                      }}
                    >
                      <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${index < 3 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-800">{row.name}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-400">{row.note}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-[13px] font-black tabular-nums text-blue-700">{row.valueLabel}</span>
                        <span className="block text-[8px] font-semibold uppercase text-slate-400">분석값</span>
                      </span>
                    </button>
                  ))}
                </div>
                {analysis.formulaNotes.length ? (
                  <details className="border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500">
                    <summary className="cursor-pointer font-bold text-slate-600">산식과 해석 기준</summary>
                    <ul className="mt-2 space-y-1.5 leading-5">
                      {analysis.formulaNotes.map((note) => <li key={note}>· {note}</li>)}
                    </ul>
                  </details>
                ) : null}
              </section>

              {interpretation ? <InterpretationCard interpretation={interpretation} /> : null}

              {selectedRegion ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="detail-title">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600">선택한 행정동</p>
                      <h2 id="detail-title" className="mt-1 text-base font-black tracking-tight text-slate-950">{compactName(selectedRegion)}</h2>
                    </div>
                    {currentRank > 0 ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">분석 {currentRank}위</span> : null}
                  </div>

                  {selectedFacility ? (
                    <article className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3" aria-label="선택한 의료기관">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wide text-cyan-700">선택한 시설</p>
                          <h3 className="mt-1 text-sm font-black text-slate-950">{selectedFacility.name}</h3>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-cyan-700">{selectedFacility.type}</span>
                      </div>
                      <dl className="mt-3 grid gap-1.5 text-[10px] leading-5 text-slate-600">
                        <div><dt className="inline font-bold text-slate-700">주소 </dt><dd className="inline">{selectedFacility.address ?? selectedFacility.adm_nm}</dd></div>
                        <div><dt className="inline font-bold text-slate-700">진료과 </dt><dd className="inline">{selectedFacility.specialties?.join(" · ") ?? "데이터 없음"}</dd></div>
                        <div><dt className="inline font-bold text-slate-700">전화 </dt><dd className="inline">{selectedFacility.phone ?? "데이터 없음"}</dd></div>
                      </dl>
                    </article>
                  ) : null}

                  {!analysis.isFacilityResult && selectedAnalysisRegion?.metrics.length ? (
                    <div className="mt-4">
                      <p className="mb-2 text-[10px] font-bold text-slate-600">현재 분석 지표</p>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedAnalysisRegion.metrics.slice(0, 4).map((metric) => (
                          <div key={metric.label} className="rounded-xl border border-blue-100 bg-blue-50/55 px-3 py-2.5" title={`${metric.formula} · ${metric.limitation}`}>
                            <p className="text-[9px] font-semibold text-blue-700">{metric.label}</p>
                            <p className="mt-1 text-sm font-black tabular-nums text-slate-950">{formatMetric(metric.value, metric.unit)}</p>
                            <p className="mt-1 line-clamp-2 text-[8px] leading-3 text-slate-400">{metric.formula}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {[
                      ["총인구", currentPopulation.toLocaleString("ko-KR"), "명"],
                      ["고령인구", currentElderly.toLocaleString("ko-KR"), `${currentPopulation ? Math.round((currentElderly / currentPopulation) * 100) : 0}%`],
                      ["의료기관", selectedFacilities.length.toLocaleString("ko-KR"), analysis.isFacilityResult ? "검색 결과" : "약국 제외"],
                      ["1인가구", currentOnePerson == null ? "데이터 없음" : currentOnePerson.toLocaleString("ko-KR"), "가구"],
                    ].map(([label, value, unit]) => (
                      <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                        <p className="text-[9px] font-semibold text-slate-400">{label}</p>
                        <p className="mt-1 truncate text-sm font-black tabular-nums text-slate-900">{value} <span className="text-[9px] font-medium text-slate-400">{unit}</span></p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[10px] font-bold text-slate-600">13개월 인구 추세</p>
                      <p className={`text-[10px] font-bold ${currentNaturalChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>자연증가 {currentNaturalChange >= 0 ? "+" : ""}{currentNaturalChange}명</p>
                    </div>
                    <TrendChart values={selectedRegion.population} labels={selectedRegion.months} />
                    <p className="mt-2 text-[9px] leading-4 text-slate-400">자연증가는 출생−사망이며 전입·전출은 포함하지 않습니다.</p>
                  </div>
                </section>
              ) : null}
            </div>
          ) : activeTab === "help" ? (
            <div className="space-y-5 px-5 pb-10 pt-5 text-sm text-slate-600">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-blue-600">3단계로 시작하기</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">부산을 질문으로 탐색하세요</h2>
                <p className="mt-2 text-xs leading-6 text-slate-500">빠른 분석을 누르거나 평소 말하듯 질문하면 지도, 순위, 행정동 상세가 함께 바뀝니다.</p>
              </div>
              {[
                ["1", "빠른 분석 선택", "의료 취약 지역, 고령 수요, 2km 접근성 등 준비된 분석을 즉시 실행합니다."],
                ["2", "지도에서 행정동 선택", "색이 칠해진 부산 행정동을 누르면 해당 지역의 13개월 추세와 세부 지표를 봅니다."],
                ["3", "반경과 시설 확인", "지도 하단의 1·2·3km를 바꿔 대표점 주변 의료 접근성을 비교합니다."],
              ].map(([number, title, description]) => (
                <article key={number} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-600 text-[11px] font-black text-white">{number}</span>
                  <div><h3 className="text-xs font-bold text-slate-900">{title}</h3><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{description}</p></div>
                </article>
              ))}
              <div className="rounded-2xl bg-slate-900 p-4 text-white">
                <p className="text-[10px] font-bold text-blue-300">질문 예시</p>
                <div className="mt-2 grid gap-1.5">
                  {["고령 인구 대비 병원이 부족한 동", "기장군과 강서구를 비교해 줘", "2km 안에 의료기관이 없는 곳"].map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="rounded-lg bg-white/7 px-2.5 py-2 text-left text-[11px] leading-5 text-slate-300 transition hover:bg-white/12 hover:text-white active:scale-[.99]"
                      onClick={() => {
                        setQuery(example);
                        setActiveTab("analysis");
                      }}
                    >
                      “{example}”
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5 px-5 pb-10 pt-5 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-blue-600">현재 스냅샷</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">{snapshot.referenceMonth}</h2>
                <p className="mt-1 text-xs text-slate-500">최근 공통 기준월 · 13개월 입력 / 12개월 변화</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["행정동", `${snapshot.regions.length}개`],
                  ["시설", `${snapshot.facilities.length}개`],
                  ["분석 기간", `${snapshot.months[0]}~`],
                  ["데이터 모드", snapshot.mode.toUpperCase()],
                  ["경계 버전", boundaryVersion],
                  ["지도 엔진", kakaoMapKey ? "Kakao Maps" : "DemoMap"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1.5 text-xs font-black text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              {snapshot.mode === "demo" ? (
                <section className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <h3 className="text-xs font-bold text-amber-900">데모 데이터 안내</h3>
                  <p className="mt-2 text-[11px] leading-5 text-amber-800">이 화면의 인구·시설 값은 기능 시연을 위한 결정론적 합성 데이터입니다. 실제 정책 판단에는 원천 공공데이터 검증이 필요합니다.</p>
                </section>
              ) : (
                <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <h3 className="text-xs font-bold text-emerald-900">게시 데이터 연결됨</h3>
                  <p className="mt-2 text-[11px] leading-5 text-emerald-800">검증된 공개 스냅샷을 표시하고 있습니다. 기준월과 원천 메모를 함께 확인하세요.</p>
                </section>
              )}
              {snapshot.sourceNotes.length ? (
                <section>
                  <h3 className="text-[11px] font-bold text-slate-700">원천 메모</h3>
                  <ul className="mt-2 space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 text-[10px] leading-5 text-slate-500">
                    {snapshot.sourceNotes.map((note) => <li key={note}>· {note}</li>)}
                  </ul>
                </section>
              ) : null}
              <section>
                <h3 className="text-[11px] font-bold text-slate-700">지표 정의</h3>
                <dl className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {[
                    ["의료기관", "종합병원·병원·요양병원·의원·치과의원·한의원·보건소. 약국은 명시 요청 때만 포함."],
                    ["최근접 거리", "행정동 내부 대표점에서 시설까지의 직선거리."],
                    ["자연증가", "출생자 수 − 사망자 수. 전입·전출 미포함."],
                    ["결측값", "알 수 없는 1인가구·운영시간은 0으로 추정하지 않고 데이터 없음으로 표시."],
                  ].map(([term, definition]) => (
                    <div key={term} className="px-4 py-3"><dt className="text-[10px] font-bold text-slate-800">{term}</dt><dd className="mt-1 text-[10px] leading-5 text-slate-500">{definition}</dd></div>
                  ))}
                </dl>
              </section>
            </div>
          )}
        </div>
      </aside>

      <section className="copilot-map" aria-label="지도 영역">
        <MapCanvas
          kakaoMapKey={kakaoMapKey}
          boundary={boundary}
          regions={snapshot.regions}
          facilities={mapFacilities}
          scores={scores}
          selectedRegionCode={selectedRegionCode}
          radiusKm={radiusKm}
          showFacilities={analysis.isFacilityResult}
          legendLabel={analysis.legendLabel}
          onSelectRegion={selectRegion}
          onSelectFacility={selectFacility}
        />

        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-2xl border border-white/75 bg-white/88 px-4 py-2.5 shadow-xl backdrop-blur-xl max-md:left-4 max-md:translate-x-0">
          <p className="text-[9px] font-bold uppercase tracking-[.09em] text-blue-600">{analysis.title}</p>
          <p className="mt-0.5 max-w-[260px] truncate text-xs font-bold text-slate-850">{selectedRegion ? compactName(selectedRegion) : "부산광역시"}</p>
        </div>

        <div className={`absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/80 bg-white/92 p-1.5 shadow-xl backdrop-blur-xl ${sheetExpanded ? "max-md:bottom-[calc(72vh+12px)]" : "max-md:bottom-[calc(44vh+12px)]"}`}>
          <span className="px-2 text-[10px] font-bold text-slate-500">접근 반경</span>
          {([1, 2, 3] as const).map((radius) => (
            <button
              key={radius}
              type="button"
              aria-label={`${radius}km 반경`}
              aria-pressed={radiusKm === radius}
              className={`rounded-xl px-3 py-2 text-[11px] font-bold transition active:scale-95 ${radiusKm === radius ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:bg-slate-100"}`}
              onPointerDown={() => runRadius(radius)}
              onClick={(event) => {
                if (event.detail === 0) runRadius(radius);
              }}
            >
              {radius}km
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
