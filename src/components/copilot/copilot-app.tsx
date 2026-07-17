"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import {
  downloadTextFile,
  facilitiesToCsv,
  rankedToCsv,
} from "@/lib/analysis/export-csv";
import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";
import { interpretAnalysisResult } from "@/lib/analysis/interpret";
import { QUERY_SUGGESTIONS } from "@/lib/analysis/query-rules";
import type { AnalysisResult, MetricDescriptor } from "@/lib/analysis/result";
import {
  applyFollowUpMerge,
  buildShareSearch,
  isFollowUpQuery,
  parseShareState,
} from "@/lib/analysis/share-state";
import { executeAnalysisIntent } from "@/lib/analysis/tool-registry";
import { FACILITY_TYPE_COLORS } from "@/lib/gis/facility-style";
import { InterpretationCard } from "./interpretation-card";
import type { LiveMapPlace } from "./kakao-map";
import { MapCanvas } from "./map-canvas";
import { PanelResizer } from "./panel-resizer";
import { TrendChart } from "./trend-chart";
import type { AnalysisSnapshot, BoundaryCollection, Facility, RegionSeries } from "./types";
import { PANEL_DEFAULTS, usePanelLayout } from "./use-panel-layout";

const RECENT_QUERIES_KEY = "ralphton-recent-queries-v1";
const UX_HINT_KEY = "ralphton-ux-hint-seen-v1";

type TabId = "control" | "help" | "data";
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

type LivePlace = LiveMapPlace & {
  categoryName: string;
  phone: string | null;
  address: string | null;
  roadAddress: string | null;
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
  { id: "scarcity", label: "의료 취약", subtitle: "공급 부족 종합", symbol: "+", tone: "bg-rose-50 text-rose-600" },
  { id: "elderly", label: "고령 × 의료", subtitle: "고령 수요 대비", symbol: "◎", tone: "bg-violet-50 text-violet-600" },
  { id: "growth", label: "인구 증가", subtitle: "12개월 압력", symbol: "↗", tone: "bg-emerald-50 text-emerald-600" },
  { id: "nearest", label: "최근접 거리", subtitle: "대표점 직선", symbol: "⌖", tone: "bg-sky-50 text-sky-600" },
  { id: "radius", label: "2km 접근", subtitle: "반경 내 기관", symbol: "◉", tone: "bg-blue-50 text-blue-600" },
  { id: "compare", label: "기장 vs 강서", subtitle: "동 단위 비교", symbol: "⇄", tone: "bg-amber-50 text-amber-700" },
  { id: "facilities", label: "의료기관", subtitle: "약국 제외", symbol: "◆", tone: "bg-cyan-50 text-cyan-700" },
  { id: "reset", label: "초기화", subtitle: "첫 화면", symbol: "↺", tone: "bg-slate-100 text-slate-600" },
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

function resultToView(id: QuickId, result: AnalysisResult, titleOverride?: string): AnalysisView {
  const isFacilityResult = id === "facilities" || result.rankedRegions.length === 0 && result.filteredFacilities.length > 0;
  const source =
    result.rankedRegions.length > 0 || isFacilityResult
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
    const mapScore =
      rawValue === null ? 0 : finite.length <= 1 ? 50 : ((rawValue - minimum) / span) * 100;
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
      note: primaryMetric
        ? `${primaryMetric.label} · ${formatMetric(primaryMetric.value, primaryMetric.unit)}`
        : "상세 지표",
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
    isFacilityResult: id === "facilities" || (result.filteredFacilities.length > 0 && ranked.length === 0),
  };
}

function executeQuickAnalysis(snapshot: AnalysisSnapshot, id: QuickId, radiusKm: 1 | 2 | 3): AnalysisView {
  const result = executeAnalysisIntent(quickIntent(id, radiusKm, snapshot.regions.length), snapshot);
  return resultToView(id, result, id === "facilities" ? "전체 의료기관" : undefined);
}

function modeBadgeLabel(mode: AnalysisSnapshot["mode"]): string {
  return mode === "live" ? "데이터: 실데이터" : "데이터: 데모";
}

function dataSourceLabel(source: string): string {
  if (source === "demo") return "출처: 로컬 데모";
  if (source === "demo-fallback") return "출처: 데모(폴백)";
  if (source === "supabase-cache") return "출처: Supabase 캐시";
  if (source === "loading") return "출처: 로딩 중";
  return `출처: ${source}`;
}

function mapEngineLabel(kakaoMapKey: string, mapEngine: "kakao" | "demo" | "unknown"): string {
  if (!kakaoMapKey) return "지도: DemoMap";
  if (mapEngine === "demo") return "지도: DemoMap(폴백)";
  if (mapEngine === "kakao") return "지도: Kakao";
  return "지도: Kakao 연결 중";
}

type CapabilityFlags = {
  kakaoMapsJs: boolean;
  kakaoRest: boolean;
  qwen: boolean;
  publicData: boolean;
  supabase: boolean;
  dataSync: boolean;
};

type PublishedLiveInfo = {
  available: boolean;
  createdAt?: string | null;
  source?: string | null;
  referenceMonth?: string;
  facilityCount?: number;
  mode?: string;
};

function toolToQuickId(tool: string): QuickId {
  const map: Record<string, QuickId> = {
    rankHospitalScarcity: "scarcity",
    rankElderlyUnderserved: "elderly",
    rankPopulationGrowthPressure: "growth",
    rankPopulationDeclineRisk: "growth",
    rankSingleHouseholdRisk: "scarcity",
    rankDeathCount: "growth",
    rankBirthCount: "growth",
    rankNaturalDecrease: "growth",
    rankPopulationDensity: "growth",
    rankPopulationSize: "growth",
    rankElderlyRatio: "elderly",
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
  const [activeTab, setActiveTab] = useState<TabId>("control");
  const [activeQuick, setActiveQuick] = useState<QuickId>("scarcity");
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<1 | 2 | 3>(2);
  const [query, setQuery] = useState("");
  const [queryNotice, setQueryNotice] = useState<string | null>(null);
  const [queryNoticeTone, setQueryNoticeTone] = useState<"neutral" | "error" | "success">("neutral");
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [customAnalysis, setCustomAnalysis] = useState<AnalysisView | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<"left" | "right" | "none">("none");
  const [livePlaces, setLivePlaces] = useState<LivePlace[]>([]);
  const [livePlacesNotice, setLivePlacesNotice] = useState<string | null>(null);
  const [mapEngine, setMapEngine] = useState<"kakao" | "demo" | "unknown">(
    kakaoMapKey ? "kakao" : "demo",
  );
  const [snapshotMode, setSnapshotMode] = useState<"auto" | "demo">("auto");
  const [capabilities, setCapabilities] = useState<CapabilityFlags | null>(null);
  const [markerScope, setMarkerScope] = useState<"priority" | "selected">("priority");
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [showUxHint, setShowUxHint] = useState(false);
  const [lastIntent, setLastIntent] = useState<AnalysisIntent | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [publishedLive, setPublishedLive] = useState<PublishedLiveInfo | null>(null);
  const [selectedLivePlace, setSelectedLivePlace] = useState<LivePlace | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [facilityTypeFilter, setFacilityTypeFilter] = useState<string | "all">("all");
  const queryInputRef = useRef<HTMLInputElement>(null);
  const shareAppliedRef = useRef(false);
  const {
    layout,
    cssVars,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    expandMap,
    resetLayout,
  } = usePanelLayout();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_QUERIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setRecentQueries(parsed.filter((item) => typeof item === "string").slice(0, 6));
      }
      if (!window.localStorage.getItem(UX_HINT_KEY)) {
        setShowUxHint(true);
        window.setTimeout(() => {
          setShowUxHint(false);
          window.localStorage.setItem(UX_HINT_KEY, "1");
        }, 6500);
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "Escape") {
        setSheetMode("none");
        return;
      }
      if (typing) return;

      if (event.key === "/" || (event.key === "k" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        setActiveTab("control");
        setSheetMode("left");
        queryInputRef.current?.focus();
        return;
      }
      if (event.key === "[" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleLeft();
      }
      if (event.key === "]" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleRight();
      }
      if (event.key === "\\" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        expandMap();
      }
      if (event.key === "0" && event.shiftKey) {
        event.preventDefault();
        resetLayout();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandMap, resetLayout, toggleLeft, toggleRight]);

  const rememberQuery = useCallback((text: string) => {
    setRecentQueries((previous) => {
      const next = [text, ...previous.filter((item) => item !== text)].slice(0, 6);
      try {
        window.localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/data/snapshot?mode=${snapshotMode}`, { signal: controller.signal }).then(
        (response) => {
          if (!response.ok) throw new Error("데모 데이터를 불러오지 못했습니다.");
          setDataSource(response.headers.get("x-data-source") ?? "unknown");
          setPublishedAt(response.headers.get("x-published-at"));
          return response.json() as Promise<AnalysisSnapshot>;
        },
      ),
      fetch(`/data/busan-administrative-dong-${boundaryVersion}.geojson`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("행정동 경계를 불러오지 못했습니다.");
        return response.json() as Promise<BoundaryCollection>;
      }),
      fetch("/api/health", { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
      fetch("/api/data/sync", { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ])
      .then(([nextSnapshot, nextBoundary, health, syncStatus]) => {
        setSnapshot(nextSnapshot);
        setBoundary(nextBoundary);
        if (health && typeof health === "object" && "capabilities" in health) {
          setCapabilities((health as { capabilities: CapabilityFlags }).capabilities);
          if ("publishedLive" in health) {
            setPublishedLive(
              (health as { publishedLive: PublishedLiveInfo }).publishedLive ?? null,
            );
          }
        }
        if (syncStatus && typeof syncStatus === "object" && "publishedLive" in syncStatus) {
          setPublishedLive(
            (syncStatus as { publishedLive: PublishedLiveInfo }).publishedLive ?? null,
          );
        }

        if (!shareAppliedRef.current && typeof window !== "undefined") {
          shareAppliedRef.current = true;
          const share = parseShareState(window.location.search);
          if (share.radius) setRadiusKm(share.radius);
          if (share.markers) setMarkerScope(share.markers);
          if (share.tab) setActiveTab(share.tab);
          if (share.q) setQuery(share.q);
          if (share.region) {
            const hit = nextSnapshot.regions.find(
              (region) =>
                region.adm_cd2 === share.region || region.adm_nm.includes(share.region ?? ""),
            );
            if (hit) setSelectedRegionCode(hit.adm_cd2);
          }
          if (share.tool) {
            const parsed = AnalysisIntentSchema.safeParse({
              tool: share.tool,
              filters: {
                radiusKm: share.radius,
                limit: nextSnapshot.regions.length,
                regions: share.region ? [share.region] : undefined,
              },
            });
            if (parsed.success) {
              const quickId = toolToQuickId(parsed.data.tool);
              const result = executeAnalysisIntent(parsed.data, nextSnapshot);
              setActiveQuick(quickId);
              setCustomAnalysis(resultToView(quickId, result));
              setLastIntent(parsed.data);
              if (result.selectedRegion) setSelectedRegionCode(result.selectedRegion.adm_cd2);
              else if (result.rankedRegions[0]) {
                setSelectedRegionCode(result.rankedRegions[0].adm_cd2);
              }
              return;
            }
          }
        }

        const initial = executeQuickAnalysis(nextSnapshot, "scarcity", 2);
        setSelectedRegionCode((current) => current ?? initial.ranked[0]?.code ?? nextSnapshot.regions[0]?.adm_cd2 ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "데이터 로드 중 오류가 발생했습니다.");
      });
    return () => controller.abort();
  }, [boundaryVersion, snapshotMode]);

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
  const rawMapFacilities = analysis?.isFacilityResult
    ? analysis.filteredFacilities
    : (analysis?.filteredFacilities.length ?? 0) > 0
      ? (analysis?.filteredFacilities ?? [])
      : defaultMedicalFacilities;
  const scopedMapFacilities =
    markerScope === "selected" && selectedRegionCode
      ? rawMapFacilities.filter((facility) => facility.adm_cd2 === selectedRegionCode)
      : rawMapFacilities;
  const mapFacilities =
    facilityTypeFilter === "all"
      ? scopedMapFacilities
      : scopedMapFacilities.filter((facility) => facility.type === facilityTypeFilter);
  const selectedFacilities = mapFacilities.filter((facility) => facility.adm_cd2 === selectedRegionCode);
  const selectedFacility =
    analysis?.filteredFacilities.find((facility) => facility.id === selectedFacilityId) ?? null;
  const selectedAnalysisRegion = analysis?.ranked.find((region) => region.code === selectedRegionCode) ?? null;

  const loadLivePlacesNearSelection = useCallback(async (region: RegionSeries | null, keyword: string) => {
    if (!region) {
      setLivePlaces([]);
      setLivePlacesNotice(null);
      return;
    }
    try {
      const params = new URLSearchParams({
        q: keyword,
        lat: String(region.representativePoint.lat),
        lng: String(region.representativePoint.lng),
        radius: "2000",
        size: "10",
      });
      const response = await fetch(`/api/kakao/places?${params.toString()}`);
      const data = (await response.json()) as {
        places?: LivePlace[];
        notice?: string;
        ok?: boolean;
      };
      setLivePlaces(data.places ?? []);
      setLivePlacesNotice(data.notice ?? null);
    } catch {
      setLivePlaces([]);
      setLivePlacesNotice("실시간 장소 검색을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void loadLivePlacesNearSelection(selectedRegion, "병원");
  }, [selectedRegion, loadLivePlacesNearSelection]);

  const selectFacility = useCallback((facility: Facility) => {
    setSelectedFacilityId(facility.id);
    setSelectedLivePlace(null);
    setSelectedRegionCode(facility.adm_cd2);
  }, []);

  const selectRegion = useCallback((code: string) => {
    setSelectedFacilityId(null);
    setSelectedLivePlace(null);
    setSelectedRegionCode(code);
  }, []);

  const selectLivePlace = useCallback((place: LiveMapPlace) => {
    setSelectedLivePlace(place as LivePlace);
    setSelectedFacilityId(null);
  }, []);

  const pushShareUrl = useCallback(
    (intent: AnalysisIntent | null, regionCode: string | null, q?: string) => {
      if (typeof window === "undefined") return;
      const search = buildShareSearch({
        tool: intent?.tool,
        region: regionCode ?? undefined,
        radius: radiusKm,
        q,
        markers: markerScope,
        tab: activeTab,
      });
      const next = `${window.location.pathname}${search}`;
      window.history.replaceState(null, "", next);
    },
    [activeTab, markerScope, radiusKm],
  );

  const copyShareLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareNotice("공유 링크를 복사했습니다.");
    } catch {
      setShareNotice("링크 복사에 실패했습니다. 주소창 URL을 복사하세요.");
    }
    window.setTimeout(() => setShareNotice(null), 2500);
  }, []);

  const exportCurrentCsv = useCallback(() => {
    if (!snapshot || !analysis) return;
    const stamp = snapshot.referenceMonth;
    if (analysis.isFacilityResult) {
      const csv = facilitiesToCsv(
        analysis.title,
        stamp,
        dataSource,
        snapshot.mode,
        analysis.filteredFacilities.map((facility) => ({
          id: facility.id,
          name: facility.name,
          type: facility.type,
          region: facility.adm_nm,
          address: facility.address ?? "",
        })),
      );
      downloadTextFile(`ralphton-facilities-${stamp}.csv`, csv);
      return;
    }
    const csv = rankedToCsv(
      analysis.title,
      stamp,
      dataSource,
      snapshot.mode,
      analysis.ranked.map((row, index) => ({
        rank: index + 1,
        code: row.code,
        name: row.name,
        valueLabel: row.valueLabel,
        note: row.note,
      })),
    );
    downloadTextFile(`ralphton-rank-${stamp}.csv`, csv);
  }, [analysis, dataSource, snapshot]);

  const runQuick = useCallback(
    (id: QuickId) => {
      if (id === "reset") {
        setActiveQuick("scarcity");
        const next = snapshot ? executeQuickAnalysis(snapshot, "scarcity", 2) : null;
        setSelectedRegionCode(next?.ranked[0]?.code ?? snapshot?.regions[0]?.adm_cd2 ?? null);
        setRadiusKm(2);
        setQuery("");
        setQueryNotice(null);
        setQueryNoticeTone("neutral");
        setQuerySuggestions([]);
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
      setActiveTab("control");
    },
    [radiusKm, snapshot],
  );

  const runRadius = useCallback(
    (radius: 1 | 2 | 3) => {
      setRadiusKm(radius);
      setActiveQuick("radius");
      setCustomAnalysis(null);
      setSelectedFacilityId(null);
      const next = snapshot ? executeQuickAnalysis(snapshot, "radius", radius) : null;
      setSelectedRegionCode(next?.ranked[0]?.code ?? selectedRegionCode);
    },
    [selectedRegionCode, snapshot],
  );

  const submitQuery = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsParsing(true);
    setQueryNotice(null);
    setQueryNoticeTone("neutral");
    setQuerySuggestions([]);
    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = (await response.json()) as {
        intent?: AnalysisIntent | null;
        notice?: string;
        suggestions?: string[];
        enrichment?: { kakaoPlacesQuery?: string; kakaoCategory?: "HP8" | "PM9" };
      };
      if (!response.ok || !data.intent?.tool) {
        setQueryNotice(
          data.notice ??
            "이 질문으로는 바로 분석하기 어렵습니다. 예시 질문을 눌러 보세요.",
        );
        setQueryNoticeTone("error");
        setQuerySuggestions(data.suggestions?.length ? data.suggestions : [...QUERY_SUGGESTIONS]);
        rememberQuery(trimmed);
        return;
      }
      rememberQuery(trimmed);
      if (!snapshot) return;

      const selectedName =
        snapshot.regions.find((region) => region.adm_cd2 === selectedRegionCode)?.adm_nm ?? null;
      const mergedIntent = applyFollowUpMerge(
        trimmed,
        data.intent,
        lastIntent,
        selectedRegionCode,
        selectedName,
      );

      if (mergedIntent.filters?.radiusKm && [1, 2, 3].includes(mergedIntent.filters.radiusKm)) {
        setRadiusKm(mergedIntent.filters.radiusKm as 1 | 2 | 3);
      }
      const quickId = toolToQuickId(mergedIntent.tool);
      const exactResult = executeAnalysisIntent(mergedIntent, snapshot);
      const nextView = resultToView(quickId, exactResult);
      setActiveQuick(quickId);
      setCustomAnalysis(nextView);
      setLastIntent(mergedIntent);
      setSelectedFacilityId(exactResult.filteredFacilities[0]?.id ?? null);
      setSelectedLivePlace(null);
      const nextRegionCode =
        exactResult.selectedRegion?.adm_cd2 ??
        exactResult.filteredFacilities[0]?.adm_cd2 ??
        exactResult.rankedRegions[0]?.adm_cd2 ??
        selectedRegionCode;
      if (nextRegionCode) setSelectedRegionCode(nextRegionCode);
      setActiveTab("control");
      const followNote = isFollowUpQuery(trimmed)
        ? " 이전 선택 지역·조건을 이어서 반영했습니다."
        : "";
      setQueryNotice((data.notice ?? "질문을 분석에 반영했습니다.") + followNote);
      setQueryNoticeTone(
        exactResult.filteredFacilities.length === 0 && exactResult.rankedRegions.length === 0
          ? "neutral"
          : "success",
      );
      pushShareUrl(mergedIntent, nextRegionCode, trimmed);

      const regionForKakao =
        snapshot.regions.find((region) => region.adm_cd2 === nextRegionCode) ??
        selectedRegion ??
        snapshot.regions[0] ??
        null;
      if (data.enrichment?.kakaoPlacesQuery && regionForKakao) {
        void loadLivePlacesNearSelection(regionForKakao, data.enrichment.kakaoPlacesQuery);
      } else if (/근처|주변|실시간|카카오|찾아/.test(trimmed) && regionForKakao) {
        const keyword = /약국/.test(trimmed)
          ? "약국"
          : /병원|의원|의료/.test(trimmed)
            ? "병원"
            : trimmed.slice(0, 20);
        void loadLivePlacesNearSelection(regionForKakao, keyword);
      }
    } catch {
      setQueryNotice("오프라인 상태입니다. 빠른 분석은 계속 사용할 수 있습니다.");
      setQueryNoticeTone("error");
      setQuerySuggestions([...QUERY_SUGGESTIONS].slice(0, 4));
    } finally {
      setIsParsing(false);
    }
  };

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-xl">
          <h1 className="text-lg font-bold text-slate-950">지도를 준비하지 못했습니다</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
        </section>
      </main>
    );
  }

  if (!snapshot || !boundary || !analysis) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#e7edf3] p-6" aria-busy="true">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-lg">
          <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-slate-200" />
          <div className="mb-2 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200" />
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
  const emptyResult =
    analysis.isFacilityResult
      ? analysis.filteredFacilities.length === 0
      : analysis.ranked.length === 0;

  return (
    <main className="copilot-shell" style={cssVars}>
      <a href="#left-panel" className="skip-link">
        분석 조작 패널로 건너뛰기
      </a>

      {/* LEFT: controls only */}
      <aside
        id="left-panel"
        className={`copilot-panel copilot-panel-left ${sheetMode === "left" ? "sheet-open" : ""} ${
          layout.leftCollapsed ? "is-collapsed" : ""
        }`}
        aria-label="분석 조작 패널"
        aria-hidden={layout.leftCollapsed || undefined}
      >
        <header className="border-b border-slate-200/80 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/brand-mark.svg"
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-[10px] shadow-sm ring-1 ring-slate-200/80"
              />
              <div className="min-w-0">
                <h1 className="truncate text-[14px] font-bold tracking-tight text-slate-950">부산 AI GIS</h1>
                <p className="mt-0.5 text-[10px] text-slate-500">기준월 {snapshot.referenceMonth}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 md:inline-flex"
                title="왼쪽 패널 접기 ( [ )"
                aria-label="왼쪽 패널 접기"
                onClick={toggleLeft}
              >
                ‹
              </button>
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
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1 text-[9px] text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{dataSourceLabel(dataSource)}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">
              {mapEngineLabel(kakaoMapKey, mapEngine)}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">
              기준월 {snapshot.referenceMonth}
            </span>
          </div>
        </header>

        <nav className="px-3 pt-3" aria-label="왼쪽 패널 탭">
          <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1" role="tablist">
            {(
              [
                ["control", "분석"],
                ["help", "이용"],
                ["data", "데이터"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`rounded-[9px] px-2 py-1.5 text-[11px] font-semibold transition hover:text-slate-800 ${
                  activeTab === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:bg-white/60"
                }`}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="copilot-scroll px-3 pb-6 pt-3">
          {activeTab === "control" ? (
            <div className="space-y-4">
              <section>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">질문</h2>
                <form className="relative" onSubmit={submitQuery}>
                  <label htmlFor="analysis-query" className="sr-only">
                    분석 질의
                  </label>
                  <input
                    id="analysis-query"
                    ref={queryInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="예: 해운대 근처 병원 · / 로 포커스"
                    maxLength={1000}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-3 pr-12 text-[13px] shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="submit"
                    aria-label="질의 실행"
                    disabled={isParsing || !query.trim()}
                    className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-[9px] bg-blue-600 text-sm font-bold text-white disabled:bg-slate-200"
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
                {querySuggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {querySuggestions.slice(0, 6).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-700"
                        onClick={() => {
                          setQuery(suggestion);
                          setQuerySuggestions([]);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
                {recentQueries.length > 0 ? (
                  <div className="mt-2">
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                      최근 질문
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {recentQueries.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="max-w-full truncate rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600 hover:border-blue-300 hover:bg-white hover:text-blue-700"
                          title={item}
                          onClick={() => setQuery(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">빠른 분석</h2>
                <div className="grid grid-cols-2 gap-1.5">
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
                      className={`min-h-[58px] rounded-xl border p-2 text-left transition active:scale-[.98] ${
                        activeQuick === item.id && item.id !== "reset"
                          ? "border-blue-300 bg-blue-50/60"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <span className={`inline-grid size-6 place-items-center rounded-md text-xs font-bold ${item.tone}`}>
                        {item.symbol}
                      </span>
                      <span className="mt-1 block text-[11px] font-bold text-slate-800">{item.label}</span>
                      <span className="block text-[9px] text-slate-400">{item.subtitle}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">접근 반경</h2>
                <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
                  {([1, 2, 3] as const).map((radius) => (
                    <button
                      key={radius}
                      type="button"
                      aria-label={`${radius}km 반경`}
                      aria-pressed={radiusKm === radius}
                      className={`flex-1 rounded-lg py-2 text-[11px] font-bold ${
                        radiusKm === radius ? "bg-slate-900 text-white" : "text-slate-500"
                      }`}
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

              <section>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">
                  지도 마커
                </h2>
                <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
                  {(
                    [
                      ["priority", "우선 표시"],
                      ["selected", "선택 동만"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={markerScope === id}
                      className={`flex-1 rounded-lg py-2 text-[11px] font-bold ${
                        markerScope === id ? "bg-slate-900 text-white" : "text-slate-500"
                      }`}
                      onClick={() => setMarkerScope(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                      facilityTypeFilter === "all"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                    onClick={() => setFacilityTypeFilter("all")}
                  >
                    전체 유형
                  </button>
                  {Object.entries(FACILITY_TYPE_COLORS).map(([type, color]) => (
                    <button
                      key={type}
                      type="button"
                      className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                        facilityTypeFilter === type ? "text-white" : "text-slate-700"
                      }`}
                      style={{
                        backgroundColor:
                          facilityTypeFilter === type ? color : `${color}22`,
                        border: `1px solid ${color}`,
                      }}
                      onClick={() =>
                        setFacilityTypeFilter((current) => (current === type ? "all" : type))
                      }
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-5 text-slate-400">
                  우선 표시·유형 필터·클러스터(2단 로드)로 핀 밀도를 조절합니다.
                </p>
              </section>

              {selectedRegion && lastIntent ? (
                <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-2.5">
                  <p className="text-[9px] font-bold text-blue-700">후속 질문 예시</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[
                      "이 동만 병원 보여줘",
                      "반경 3km로",
                      "이 결과에서 약국만",
                    ].map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[9px] text-blue-800"
                        onClick={() => setQuery(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <p className="text-[10px] leading-5 text-slate-400">
                순위·상세·해석은 오른쪽 패널에 표시됩니다. 패널 경계를 드래그해 너비를 조절할 수 있습니다.
              </p>
            </div>
          ) : activeTab === "help" ? (
            <div className="space-y-3 text-[12px] text-slate-600">
              <p className="font-bold text-slate-900">30초 이용 방법</p>
              <ol className="list-decimal space-y-2 pl-4 text-[11px] leading-5">
                <li>빠른 분석 또는 질문을 실행합니다.</li>
                <li>지도에서 행정동·시설을 선택합니다.</li>
                <li>오른쪽에서 순위·해석·상세를 확인합니다.</li>
              </ol>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-5">
                <p className="font-bold text-slate-900">편의 단축키 (데스크톱)</p>
                <ul className="mt-1.5 space-y-1 text-slate-600">
                  <li>
                    <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">/</kbd> 질문 입력 포커스
                  </li>
                  <li>
                    <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">[</kbd> /
                    <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">]</kbd> 좌·우 패널 접기
                  </li>
                  <li>
                    <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">\</kbd> 지도 넓게 (양쪽 접기)
                  </li>
                  <li>
                    <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">Shift+0</kbd> 패널 크기 초기화
                  </li>
                  <li>패널 경계 드래그 · 더블클릭으로 초기화</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-900 p-3 text-white">
                <p className="text-[10px] font-bold text-blue-300">질문 예시</p>
                {QUERY_SUGGESTIONS.slice(0, 5).map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="mt-1.5 block w-full rounded-lg bg-white/10 px-2 py-1.5 text-left text-[11px] text-slate-200"
                    onClick={() => {
                      setQuery(example);
                      setActiveTab("control");
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-[11px] text-slate-600">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["행정동", `${snapshot.regions.length}`],
                  ["시설", `${snapshot.facilities.length}`],
                  ["경계", boundaryVersion],
                  ["스냅샷 모드", snapshot.mode],
                  ["기준월", snapshot.referenceMonth],
                  ["출처 헤더", dataSource],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <p className="text-[9px] text-slate-400">{label}</p>
                    <p className="mt-1 font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-bold text-slate-700">스냅샷 선택</p>
                <div className="mt-2 flex gap-1">
                  {(
                    [
                      ["auto", "자동(실데이터 우선)"],
                      ["demo", "로컬 데모"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`flex-1 rounded-lg py-2 text-[10px] font-bold ${
                        snapshotMode === mode
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                      onClick={() => setSnapshotMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {capabilities ? (
                <section className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-bold text-slate-700">서버 연동 상태</p>
                  <ul className="mt-2 space-y-1 text-[10px] leading-5">
                    {(
                      [
                        ["Kakao 지도 JS", capabilities.kakaoMapsJs],
                        ["Kakao REST", capabilities.kakaoRest],
                        ["Qwen 파서", capabilities.qwen],
                        ["공공데이터", capabilities.publicData],
                        ["Supabase", capabilities.supabase],
                        ["시설 동기화", capabilities.dataSync],
                      ] as const
                    ).map(([label, on]) => (
                      <li key={label} className="flex items-center justify-between gap-2">
                        <span>{label}</span>
                        <span
                          className={`font-bold ${on ? "text-emerald-600" : "text-slate-400"}`}
                        >
                          {on ? "연결" : "미설정"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {capabilities.dataSync ? (
                    <p className="mt-2 text-[10px] leading-5 text-slate-500">
                      시설 live sync: <code className="rounded bg-slate-100 px-1">POST /api/data/sync</code>
                      {" "}(헤더 <code className="rounded bg-slate-100 px-1">x-sync-secret</code>)
                    </p>
                  ) : (
                    <p className="mt-2 text-[10px] leading-5 text-amber-800">
                      DATA_SYNC_SECRET이 없으면 시설 동기화 API는 비활성입니다.
                    </p>
                  )}
                  {publishedLive?.available ? (
                    <div className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] leading-5 text-emerald-900">
                      <p className="font-bold">게시된 실데이터 스냅샷</p>
                      <p>기준월 {publishedLive.referenceMonth ?? "—"}</p>
                      <p>
                        갱신{" "}
                        {publishedLive.createdAt
                          ? new Date(publishedLive.createdAt).toLocaleString("ko-KR")
                          : "시각 없음"}
                      </p>
                      <p>시설 {publishedLive.facilityCount?.toLocaleString("ko-KR") ?? "—"}곳</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] leading-5 text-slate-500">
                      게시된 live 스냅샷이 없습니다. 동기화 후 auto 모드에서 사용됩니다.
                    </p>
                  )}
                  {publishedAt ? (
                    <p className="mt-1 text-[10px] text-slate-500">
                      현재 로드 캐시 시각: {new Date(publishedAt).toLocaleString("ko-KR")}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {snapshot.mode === "demo" ? (
                <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-amber-900">
                  인구·시설은 시연용 합성 데이터일 수 있습니다. 실시간 장소는 카카오 REST가 있을 때만
                  보강됩니다. 정책 판단에는 원천 통계를 사용하세요.
                </p>
              ) : (
                <p className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-900">
                  실데이터 스냅샷 모드입니다. 출처 노트와 기준월을 함께 확인하세요.
                </p>
              )}
              {snapshot.sourceNotes.slice(0, 5).map((note) => (
                <p key={note} className="text-[10px] leading-5 text-slate-500">
                  · {note}
                </p>
              ))}
            </div>
          )}
        </div>
      </aside>

      <PanelResizer
        side="left"
        width={layout.left}
        disabled={layout.leftCollapsed}
        label="왼쪽 패널 너비 조절"
        onResize={setLeftWidth}
        onReset={() => {
          setLeftWidth(PANEL_DEFAULTS.left);
        }}
      />

      {/* CENTER: map */}
      <section className="copilot-map" aria-label="지도 영역">
        <MapCanvas
          kakaoMapKey={kakaoMapKey}
          boundary={boundary}
          regions={snapshot.regions}
          facilities={mapFacilities}
          livePlaces={livePlaces}
          scores={scores}
          selectedRegionCode={selectedRegionCode}
          radiusKm={radiusKm}
          showFacilities={analysis.isFacilityResult}
          legendLabel={analysis.legendLabel}
          onSelectRegion={selectRegion}
          onSelectFacility={selectFacility}
          onSelectLivePlace={selectLivePlace}
          onEngineChange={setMapEngine}
        />

        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-2xl border border-white/80 bg-white/90 px-4 py-2 shadow-lg backdrop-blur max-md:left-3 max-md:translate-x-0">
          <p className="text-[9px] font-bold uppercase tracking-wide text-blue-600">{analysis.title}</p>
          <p className="max-w-[240px] truncate text-xs font-bold text-slate-900">
            {selectedRegion ? compactName(selectedRegion) : "부산광역시"}
          </p>
        </div>

        {layout.leftCollapsed ? (
          <div className="panel-rail panel-rail-left pointer-events-auto">
            <button
              type="button"
              className="panel-rail-btn"
              title="조작 패널 열기 ( [ )"
              aria-label="조작 패널 열기"
              onClick={toggleLeft}
            >
              ›
            </button>
          </div>
        ) : null}
        {layout.rightCollapsed ? (
          <div className="panel-rail panel-rail-right pointer-events-auto">
            <button
              type="button"
              className="panel-rail-btn"
              title="결과 패널 열기 ( ] )"
              aria-label="결과 패널 열기"
              onClick={toggleRight}
            >
              ‹
            </button>
          </div>
        ) : null}

        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 max-md:bottom-20">
          <button
            type="button"
            className="mobile-panel-btn"
            onClick={() => setSheetMode((mode) => (mode === "left" ? "none" : "left"))}
          >
            조작
          </button>
          <button
            type="button"
            className="mobile-panel-btn"
            onClick={() => setSheetMode((mode) => (mode === "right" ? "none" : "right"))}
          >
            결과
          </button>
          <div className="hidden gap-1.5 md:flex">
            <button
              type="button"
              className="rounded-full border border-white/80 bg-white/92 px-3 py-1.5 text-[10px] font-bold text-slate-700 shadow-lg backdrop-blur"
              title="지도 넓게 ( \\ )"
              onClick={expandMap}
            >
              지도 넓게
            </button>
            <button
              type="button"
              className="rounded-full border border-white/80 bg-white/92 px-3 py-1.5 text-[10px] font-bold text-slate-700 shadow-lg backdrop-blur"
              title="패널 크기 초기화 ( Shift+0 )"
              onClick={resetLayout}
            >
              레이아웃 초기화
            </button>
          </div>
        </div>

        {showUxHint ? (
          <p className="ux-hint" role="status">
            패널 경계를 드래그해 크기를 조절 · / 질문 포커스 · [ ] 패널 접기
          </p>
        ) : null}
      </section>

      <PanelResizer
        side="right"
        width={layout.right}
        disabled={layout.rightCollapsed}
        label="오른쪽 패널 너비 조절"
        onResize={setRightWidth}
        onReset={() => {
          setRightWidth(PANEL_DEFAULTS.right);
        }}
      />

      {/* RIGHT: results */}
      <aside
        className={`copilot-panel copilot-panel-right ${sheetMode === "right" ? "sheet-open" : ""} ${
          layout.rightCollapsed ? "is-collapsed" : ""
        }`}
        aria-label="분석 결과 패널"
        aria-hidden={layout.rightCollapsed || undefined}
        data-testid="result-panel"
      >
        <header className="border-b border-slate-200/80 px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.08em] text-blue-600">분석 결과</p>
              <h2 className="mt-1 text-[15px] font-bold text-slate-950">{analysis.title}</h2>
            </div>
            <button
              type="button"
              className="hidden shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 md:inline-flex"
              title="오른쪽 패널 접기 ( ] )"
              aria-label="오른쪽 패널 접기"
              onClick={toggleRight}
            >
              ›
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{analysis.summary}</p>
          <div
            className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[10px] leading-5 ${
              snapshot.mode === "live"
                ? "border-emerald-100 bg-emerald-50 text-emerald-900"
                : "border-amber-100 bg-amber-50 text-amber-900"
            }`}
            data-testid="data-provenance"
          >
            <span className="font-bold">
              {snapshot.mode === "live" ? "실데이터" : "데모 데이터"}
            </span>
            {" · "}기준월 {snapshot.referenceMonth}
            {" · "}
            {dataSourceLabel(dataSource)}
            {publishedAt
              ? ` · 게시 ${new Date(publishedAt).toLocaleDateString("ko-KR")}`
              : ""}
            {snapshot.mode === "demo"
              ? " · 정책 판단용 원천 통계 아님"
              : " · 인구 시계열은 기준 스냅샷 유지 가능"}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {analysis.isFacilityResult
                ? `${analysis.filteredFacilities.length}개 시설`
                : `${analysis.ranked.length}개 동`}
            </span>
            {currentRank > 0 ? (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                선택 {currentRank}위
              </span>
            ) : null}
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:border-blue-300"
              onClick={exportCurrentCsv}
            >
              CSV 내보내기
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:border-blue-300"
              onClick={() => {
                pushShareUrl(
                  lastIntent ?? {
                    tool: "rankHospitalScarcity",
                    filters: { limit: snapshot.regions.length, radiusKm },
                  },
                  selectedRegionCode,
                  query || undefined,
                );
                void copyShareLink();
              }}
            >
              링크 복사
            </button>
          </div>
          {shareNotice ? (
            <p className="mt-1.5 text-[10px] font-semibold text-emerald-700" role="status">
              {shareNotice}
            </p>
          ) : null}
        </header>

        <div className="copilot-scroll space-y-4 px-3 pb-8 pt-3">
          {emptyResult ? (
            <section className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[11px] leading-5 text-amber-900">
              요청 조건에 맞는 분석 데이터가 없습니다. 운영시간·진료과처럼 원천에 없는 값은 추정하지 않습니다.
              다른 빠른 분석이나 예시 질문으로 이어서 볼 수 있습니다.
            </section>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold text-slate-500">
              {analysis.isFacilityResult ? "시설 목록" : "상위 순위"}
            </div>
            <div className="divide-y divide-slate-100">
              {analysis.isFacilityResult
                ? analysis.filteredFacilities.slice(0, 12).map((facility) => (
                    <button
                      key={facility.id}
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 ${
                        facility.id === selectedFacilityId ? "bg-blue-50/70" : ""
                      }`}
                      onPointerDown={() => selectFacility(facility)}
                      onClick={(event) => {
                        if (event.detail === 0) selectFacility(facility);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-800">{facility.name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {facility.type} · {facility.adm_nm.replace("부산광역시 ", "")}
                        </span>
                      </span>
                    </button>
                  ))
                : analysis.ranked.slice(0, 10).map((row, index) => (
                    <button
                      key={row.code}
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 ${
                        row.code === selectedRegionCode ? "bg-blue-50/70" : ""
                      }`}
                      onPointerDown={() => selectRegion(row.code)}
                      onClick={(event) => {
                        if (event.detail === 0) selectRegion(row.code);
                      }}
                    >
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                          index < 3 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-800">{row.name}</span>
                        <span className="block text-[10px] text-slate-400">{row.note}</span>
                      </span>
                      <span className="text-[12px] font-black tabular-nums text-blue-700">{row.valueLabel}</span>
                    </button>
                  ))}
            </div>
            {analysis.formulaNotes.length ? (
              <details className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-500">
                <summary className="cursor-pointer font-bold text-slate-600">산식과 해석 기준</summary>
                <ul className="mt-2 space-y-1 leading-5">
                  {analysis.formulaNotes.map((note) => (
                    <li key={note}>· {note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {interpretation ? <InterpretationCard interpretation={interpretation} /> : null}

          {selectedRegion ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-[10px] font-semibold text-blue-600">선택 행정동</p>
              <h3 className="mt-1 text-sm font-black text-slate-950">{compactName(selectedRegion)}</h3>

              {selectedFacility ? (
                <article className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/70 p-2.5 text-[10px] text-slate-600">
                  <p className="font-bold text-cyan-800">{selectedFacility.name}</p>
                  <p className="mt-1">{selectedFacility.type}</p>
                  <p className="mt-1">{selectedFacility.address ?? selectedFacility.adm_nm}</p>
                  <p className="mt-1">전화 {selectedFacility.phone ?? "데이터 없음"}</p>
                </article>
              ) : null}

              {selectedLivePlace ? (
                <article className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-2.5 text-[10px] text-slate-600">
                  <p className="text-[9px] font-bold text-violet-700">카카오 실시간 장소</p>
                  <p className="mt-1 font-bold text-violet-900">{selectedLivePlace.name}</p>
                  <p className="mt-1">{selectedLivePlace.categoryName}</p>
                  <p className="mt-1">
                    {selectedLivePlace.roadAddress ?? selectedLivePlace.address ?? "주소 없음"}
                  </p>
                  <p className="mt-1">
                    전화 {selectedLivePlace.phone ?? "데이터 없음"}
                    {selectedLivePlace.distanceMeters != null
                      ? ` · ${selectedLivePlace.distanceMeters}m`
                      : ""}
                  </p>
                </article>
              ) : null}

              {!analysis.isFacilityResult && selectedAnalysisRegion?.metrics.length ? (
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {selectedAnalysisRegion.metrics.slice(0, 4).map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-blue-100 bg-blue-50/50 px-2.5 py-2">
                      <p className="text-[9px] font-semibold text-blue-700">{metric.label}</p>
                      <p className="mt-1 text-sm font-black tabular-nums text-slate-950">
                        {formatMetric(metric.value, metric.unit)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {[
                  ["총인구", currentPopulation.toLocaleString("ko-KR")],
                  ["고령", currentElderly.toLocaleString("ko-KR")],
                  ["의료기관", String(selectedFacilities.length)],
                  ["1인가구", currentOnePerson == null ? "없음" : currentOnePerson.toLocaleString("ko-KR")],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400">{label}</p>
                    <p className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-600">13개월 인구</p>
                  <p
                    className={`text-[10px] font-bold ${
                      currentNaturalChange >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    자연증가 {currentNaturalChange >= 0 ? "+" : ""}
                    {currentNaturalChange}
                  </p>
                </div>
                <TrendChart values={selectedRegion.population} labels={selectedRegion.months} />
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold text-slate-600">실시간 주변 장소</p>
                <p className="text-[9px] text-slate-400">카카오 로컬 REST · 선택 동 대표점 기준</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600"
                onClick={() => void loadLivePlacesNearSelection(selectedRegion, "병원")}
              >
                새로고침
              </button>
            </div>
            {livePlacesNotice ? (
              <p className="mt-2 text-[10px] leading-5 text-slate-500">{livePlacesNotice}</p>
            ) : null}
            <div className="mt-2 divide-y divide-slate-100">
              {livePlaces.length === 0 ? (
                <p className="py-3 text-[11px] text-slate-500">
                  표시할 실시간 장소가 없습니다. REST 키·도메인 설정을 확인하세요.
                </p>
              ) : (
                livePlaces.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className={`w-full py-2 text-left hover:bg-slate-50 ${
                      selectedLivePlace?.id === place.id ? "bg-violet-50" : ""
                    }`}
                    onClick={() => selectLivePlace(place)}
                  >
                    <p className="text-xs font-bold text-slate-800">{place.name}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {place.categoryName ? `${place.categoryName} · ` : ""}
                      {place.roadAddress ?? place.address ?? "주소 없음"}
                      {place.distanceMeters != null ? ` · ${place.distanceMeters}m` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}
