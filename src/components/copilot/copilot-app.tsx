"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  downloadTextFile,
  facilitiesToCsv,
  rankedToCsv,
} from "@/lib/analysis/export-csv";
import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";
import {
  buildOneLineConclusion,
  interpretAnalysisResult,
} from "@/lib/analysis/interpret";
import {
  EVALUATOR_CRITERIA,
  EVALUATOR_SCRIPT,
  METHOD_SUMMARY,
} from "@/lib/analysis/evaluator-guide";
import { QUERY_SUGGESTIONS } from "@/lib/analysis/query-rules";
import type { AnalysisResult, MetricDescriptor } from "@/lib/analysis/result";
import {
  DEFAULT_COMPARE,
  listDistricts,
  listDongLabels,
  normalizeComparePair,
  type CompareScope,
} from "@/lib/analysis/districts";
import {
  applySidoScopeToRegions,
  countBySido,
  filterBySidoScope,
  matchesSidoScope,
  sidoBadge,
  SIDO_SCOPE_LABEL,
  type SidoScope,
} from "@/lib/analysis/scope";
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
import {
  applyResolvedTheme,
  cycleThemePreference,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_LABELS,
  type ThemePreference,
} from "@/lib/ui/theme";
import {
  LAYOUT_PRESETS,
  PANEL_DEFAULTS,
  type LayoutPresetId,
  usePanelLayout,
} from "./use-panel-layout";

const RECENT_QUERIES_KEY = "ralphton-recent-queries-v1";
const SIDO_SCOPE_KEY = "ralphton-sido-scope-v1";
const DENSITY_KEY = "ralphton-density-v1";
const ONBOARD_KEY = "ralphton-onboard-v1";

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
  { id: "scarcity", label: "의료 취약", subtitle: "어디가 부족한가", symbol: "+", tone: "bg-rose-50 text-rose-600" },
  { id: "elderly", label: "고령 × 의료", subtitle: "노인 수요 대비", symbol: "◎", tone: "bg-violet-50 text-violet-600" },
  { id: "growth", label: "인구 증가", subtitle: "최근 1년 변화", symbol: "↗", tone: "bg-emerald-50 text-emerald-600" },
  { id: "nearest", label: "최근접 거리", subtitle: "가장 가까운 병원", symbol: "⌖", tone: "bg-sky-50 text-sky-600" },
  { id: "radius", label: "주변 접근", subtitle: "반경 안 기관 수", symbol: "◉", tone: "bg-blue-50 text-blue-600" },
  { id: "compare", label: "구 비교", subtitle: "두 지역 선택", symbol: "⇄", tone: "bg-amber-50 text-amber-700" },
  { id: "facilities", label: "의료기관", subtitle: "병원·의원 목록", symbol: "◆", tone: "bg-cyan-50 text-cyan-700" },
  { id: "reset", label: "초기화", subtitle: "처음부터", symbol: "↺", tone: "bg-slate-100 text-slate-600" },
];

function compactName(region: RegionSeries): string {
  return region.adm_nm.replace(/^부산광역시\s*/, "").replace(/^경상남도\s*/, "");
}

function quickIntent(
  id: QuickId,
  radiusKm: 1 | 2 | 3,
  regionLimit: number,
  comparePair: [string, string] = DEFAULT_COMPARE,
  sidoScope: SidoScope = "all",
): AnalysisIntent {
  const limit = Math.max(1, Math.min(regionLimit, 600));
  const regions = applySidoScopeToRegions(undefined, sidoScope);
  const intents: Record<QuickId, AnalysisIntent> = {
    scarcity: { tool: "rankHospitalScarcity", filters: { limit, regions } },
    elderly: { tool: "rankElderlyUnderserved", filters: { limit, regions } },
    growth: { tool: "rankPopulationGrowthPressure", filters: { limit, regions } },
    nearest: { tool: "nearestFacilityDistance", filters: { limit, regions } },
    radius: { tool: "countFacilitiesWithinRadius", filters: { radiusKm, limit, regions } },
    compare: { tool: "compareRegions", filters: { compare: [...comparePair] } },
    facilities: {
      tool: "filterFacilitiesByTypeAndHours",
      filters: { regions },
    },
    reset: { tool: "rankHospitalScarcity", filters: { limit, regions } },
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
      name: region.adm_nm.replace(/^부산광역시\s*/, "").replace(/^경상남도\s*/, ""),
      district: region.adm_nm.split(" ")[1] ?? "지역",
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

function executeQuickAnalysis(
  snapshot: AnalysisSnapshot,
  id: QuickId,
  radiusKm: 1 | 2 | 3,
  comparePair: [string, string] = DEFAULT_COMPARE,
  sidoScope: SidoScope = "all",
): AnalysisView {
  const scopedRegionCount = filterBySidoScope(snapshot.regions, sidoScope).length;
  const result = executeAnalysisIntent(
    quickIntent(id, radiusKm, scopedRegionCount || snapshot.regions.length, comparePair, sidoScope),
    snapshot,
  );
  const scopeLabel = sidoScope === "all" ? "" : ` · ${SIDO_SCOPE_LABEL[sidoScope]}`;
  const titleOverride =
    id === "facilities"
      ? `의료기관${scopeLabel}`
      : id === "compare"
        ? `${comparePair[0]} vs ${comparePair[1]}`
        : undefined;
  return resultToView(id, result, titleOverride);
}

const MAP_FACILITY_CAP = 900;
const RESULT_PAGE_STEP = 24;

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
  cronAlert?: boolean;
  populationLive?: boolean;
  ragRemoteEmbed?: boolean;
};

function formatSyncStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "hybrid-live":
      return "시설+인구 live";
    case "facilities-live":
      return "시설 live";
    case "demo-only":
      return "시연만";
    case "failed":
      return "실패";
    case "idle":
      return "대기";
    default:
      return status?.trim() || "알 수 없음";
  }
}

function populationNoteFromSnapshot(notes: string[]): string | null {
  const hit = notes.find(
    (note) => note.includes("인구") && (note.includes("live") || note.includes("스냅샷")),
  );
  return hit ?? null;
}

type PublishedLiveInfo = {
  available: boolean;
  createdAt?: string | null;
  source?: string | null;
  referenceMonth?: string;
  facilityCount?: number;
  mode?: string;
};

type SyncOpsInfo = {
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastStatus?: string | null;
  lastFacilityCount?: number | null;
  lastError?: string | null;
  lastPublished?: boolean | null;
  recommendedIntervalHours?: number;
  stale?: boolean;
  recommendSync?: boolean;
  reason?: string | null;
  hoursSincePublish?: number | null;
  hoursSinceAttempt?: number | null;
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
  const [parseStage, setParseStage] = useState<"idle" | "intent" | "analyze" | "done">("idle");
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
  const [showOnboard, setShowOnboard] = useState(false);
  const [comparePair, setComparePair] = useState<[string, string]>(DEFAULT_COMPARE);
  const [compareScope, setCompareScope] = useState<CompareScope>("gu");
  const [lastIntent, setLastIntent] = useState<AnalysisIntent | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [publishedLive, setPublishedLive] = useState<PublishedLiveInfo | null>(null);
  const [syncOps, setSyncOps] = useState<SyncOpsInfo | null>(null);
  const [selectedLivePlace, setSelectedLivePlace] = useState<LivePlace | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [facilityTypeFilter, setFacilityTypeFilter] = useState<string | "all">("all");
  /** Map/list/analysis scope: 전체 · 부산 · 경남 */
  const [sidoScope, setSidoScope] = useState<SidoScope>("all");
  const [resultSearch, setResultSearch] = useState("");
  const [resultLimit, setResultLimit] = useState(RESULT_PAGE_STEP);
  /** Facility list sort when showing facilities */
  const [facilitySort, setFacilitySort] = useState<"name" | "type">("name");
  const [reloadToken, setReloadToken] = useState(0);
  const densityHydratedRef = useRef(false);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const shareAppliedRef = useRef(false);
  const staleToastShownRef = useRef(false);
  const {
    layout,
    cssVars,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    expandMap,
    resetLayout,
    applyPreset,
  } = usePanelLayout();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [toast, setToast] = useState<string | null>(null);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>("balanced");
  const [drillTrail, setDrillTrail] = useState<string[]>([]);
  const [sheetHeight, setSheetHeight] = useState(72);
  const sheetDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    if (densityHydratedRef.current) {
      try {
        window.localStorage.setItem(DENSITY_KEY, density);
      } catch {
        /* ignore */
      }
    }
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);

  // Hydrate theme preference once; bootstrap script already painted resolved theme.
  useEffect(() => {
    setThemePreference(readStoredTheme());
    try {
      const d = window.localStorage.getItem(DENSITY_KEY);
      if (d === "comfortable" || d === "compact") setDensity(d);
    } catch {
      /* ignore */
    }
    densityHydratedRef.current = true;
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(themePreference));
    storeTheme(themePreference);
    if (themePreference !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    try {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyResolvedTheme(resolveTheme("system"));
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    } catch {
      return undefined;
    }
  }, [themePreference]);

  useEffect(() => {
    try {
      const savedSido = window.localStorage.getItem(SIDO_SCOPE_KEY);
      if (savedSido === "all" || savedSido === "busan" || savedSido === "gyeongnam") {
        setSidoScope(savedSido);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_QUERIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setRecentQueries(parsed.filter((item) => typeof item === "string").slice(0, 6));
      }
      if (!window.localStorage.getItem(ONBOARD_KEY)) {
        setShowOnboard(true);
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
      // Shift+D — cycle system → light → dark → contrast
      if ((event.key === "D" || event.key === "d") && event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setThemePreference((current) => {
          const next = cycleThemePreference(current);
          showToast(`테마: ${THEME_LABELS[next]}`);
          return next;
        });
      }

      // Digit 1/2/3 — map scope: 전체 / 부산 / 경남
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "1" || event.key === "2" || event.key === "3")
      ) {
        event.preventDefault();
        const map: Record<string, SidoScope> = {
          "1": "all",
          "2": "busan",
          "3": "gyeongnam",
        };
        const next = map[event.key];
        if (next) {
          setSidoScope(next);
          setCustomAnalysis(null);
          setResultLimit(RESULT_PAGE_STEP);
          setResultSearch("");
          try {
            window.localStorage.setItem(SIDO_SCOPE_KEY, next);
          } catch {
            /* ignore */
          }
          showToast(`지도 범위: ${SIDO_SCOPE_LABEL[next]}`);
        }
      }

      // Rank list keyboard navigation
      if (
        (event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "j" ||
          event.key === "k") &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        const list =
          customAnalysis?.ranked ??
          (snapshot
            ? executeQuickAnalysis(snapshot, activeQuick, radiusKm, comparePair, sidoScope).ranked
            : []);
        if (list.length === 0) return;
        event.preventDefault();
        const current = list.findIndex((row) => row.code === selectedRegionCode);
        const delta =
          event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(list.length - 1, (current < 0 ? 0 : current) + delta));
        const next = list[nextIndex];
        if (next) {
          setSelectedFacilityId(null);
          setSelectedLivePlace(null);
          setSelectedRegionCode(next.code);
          setSheetMode((mode) => (mode === "none" ? "right" : mode));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeQuick,
    comparePair,
    customAnalysis,
    expandMap,
    radiusKm,
    resetLayout,
    selectedRegionCode,
    snapshot,
    showToast,
    toggleLeft,
    toggleRight,
  ]);

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
          if ("syncOps" in health && (health as { syncOps?: SyncOpsInfo }).syncOps) {
            setSyncOps((health as { syncOps: SyncOpsInfo }).syncOps);
          }
        }
        if (syncStatus && typeof syncStatus === "object") {
          if ("publishedLive" in syncStatus) {
            setPublishedLive(
              (syncStatus as { publishedLive: PublishedLiveInfo }).publishedLive ?? null,
            );
          }
          if ("syncOps" in syncStatus && (syncStatus as { syncOps?: SyncOpsInfo }).syncOps) {
            const ops = (syncStatus as { syncOps: SyncOpsInfo }).syncOps;
            setSyncOps(ops);
            if (
              !staleToastShownRef.current &&
              (ops.stale || ops.recommendSync) &&
              ops.reason
            ) {
              staleToastShownRef.current = true;
              const msg = ops.reason.length > 52 ? `${ops.reason.slice(0, 52)}…` : ops.reason;
              setToast(msg);
              window.setTimeout(() => setToast(null), 3200);
            }
          }
        }

        if (!shareAppliedRef.current && typeof window !== "undefined") {
          shareAppliedRef.current = true;
          const share = parseShareState(window.location.search);
          if (share.radius) setRadiusKm(share.radius);
          if (share.markers) setMarkerScope(share.markers);
          if (share.tab) setActiveTab(share.tab);
          if (share.q) setQuery(share.q);
          if (share.sido) setSidoScope(share.sido);
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

        const districts = listDistricts(nextSnapshot.regions);
        if (districts.length >= 2) {
          setComparePair((current) => normalizeComparePair(current[0], current[1], districts));
        }

        const initial = executeQuickAnalysis(nextSnapshot, "scarcity", 2, DEFAULT_COMPARE, "all");
        setSelectedRegionCode((current) => current ?? initial.ranked[0]?.code ?? nextSnapshot.regions[0]?.adm_cd2 ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "데이터 로드 중 오류가 발생했습니다.");
      });
    return () => controller.abort();
  }, [boundaryVersion, snapshotMode, reloadToken]);

  const districtOptions = useMemo(
    () => (snapshot ? listDistricts(snapshot.regions) : [...DEFAULT_COMPARE]),
    [snapshot],
  );

  const dongOptions = useMemo(
    () => (snapshot ? listDongLabels(snapshot.regions) : []),
    [snapshot],
  );

  const compareOptions = compareScope === "dong" ? dongOptions : districtOptions;

  const analysis = useMemo(
    () =>
      customAnalysis ??
      (snapshot
        ? executeQuickAnalysis(snapshot, activeQuick, radiusKm, comparePair, sidoScope)
        : null),
    [snapshot, activeQuick, radiusKm, customAnalysis, comparePair, sidoScope],
  );

  const dismissOnboard = useCallback(() => {
    setShowOnboard(false);
    try {
      window.localStorage.setItem(ONBOARD_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const runOnboardExample = useCallback(() => {
    dismissOnboard();
    setActiveTab("control");
    setActiveQuick("scarcity");
    setCustomAnalysis(null);
    setSelectedFacilityId(null);
    setDrillTrail([]);
    if (snapshot) {
      const next = executeQuickAnalysis(snapshot, "scarcity", radiusKm, comparePair, sidoScope);
      if (next.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
    }
    setSheetMode("right");
    showToast("의료 취약 분석 시작");
  }, [comparePair, dismissOnboard, radiusKm, showToast, sidoScope, snapshot]);

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

  const isCompareView = Boolean(
    activeQuick === "compare" ||
      lastIntent?.tool === "compareRegions" ||
      analysis?.title.includes("지역 비교") ||
      analysis?.title.includes(" vs "),
  );

  const oneLineConclusion = useMemo(() => {
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
    return buildOneLineConclusion(
      {
        title: analysis.title,
        summary: analysis.summary,
        rankedRegions,
        selectedRegion: rankedRegions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null,
        filteredFacilities: analysis.filteredFacilities,
        legend: [],
        formulaNotes: analysis.formulaNotes,
      },
      { selectedRegionCode },
    );
  }, [analysis, selectedRegionCode, snapshot]);

  const focusRegionCodes = useMemo(() => {
    if (!snapshot || !isCompareView) return null;
    const codes = new Set<string>();
    for (const token of comparePair) {
      for (const region of snapshot.regions) {
        if (region.adm_cd2 === token || region.adm_nm.includes(token)) {
          codes.add(region.adm_cd2);
        }
      }
    }
    for (const row of analysis?.ranked ?? []) {
      codes.add(row.code);
    }
    return codes.size > 0 ? codes : null;
  }, [analysis?.ranked, comparePair, isCompareView, snapshot]);

  const scopedRegions = useMemo(() => {
    if (!snapshot) return [];
    return filterBySidoScope(snapshot.regions, sidoScope);
  }, [sidoScope, snapshot]);

  const scopedBoundary = useMemo((): BoundaryCollection | null => {
    if (!boundary || !snapshot) return boundary;
    if (sidoScope === "all") return boundary;
    const codes = new Set(scopedRegions.map((region) => region.adm_cd2));
    return {
      ...boundary,
      features: boundary.features.filter((feature) => codes.has(feature.properties.adm_cd2)),
    };
  }, [boundary, scopedRegions, sidoScope, snapshot]);

  const sidoMix = useMemo(
    () => (snapshot ? countBySido(snapshot.regions) : { busan: 0, gyeongnam: 0, other: 0 }),
    [snapshot],
  );
  const facilitySidoMix = useMemo(
    () => (snapshot ? countBySido(snapshot.facilities) : { busan: 0, gyeongnam: 0, other: 0 }),
    [snapshot],
  );

  const selectedRegion = snapshot?.regions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null;
  const defaultMedicalFacilities = snapshot?.facilities.filter((facility) => facility.type !== "약국") ?? [];
  const rawMapFacilities = analysis?.isFacilityResult
    ? analysis.filteredFacilities
    : (analysis?.filteredFacilities.length ?? 0) > 0
      ? (analysis?.filteredFacilities ?? [])
      : defaultMedicalFacilities;
  const sidoFilteredFacilities = rawMapFacilities.filter((facility) =>
    matchesSidoScope(facility.adm_nm, sidoScope),
  );
  const scopedMapFacilities =
    markerScope === "selected" && selectedRegionCode
      ? sidoFilteredFacilities.filter((facility) => facility.adm_cd2 === selectedRegionCode)
      : sidoFilteredFacilities;
  const typedMapFacilities =
    facilityTypeFilter === "all"
      ? scopedMapFacilities
      : scopedMapFacilities.filter((facility) => facility.type === facilityTypeFilter);
  const mapFacilitiesCapped = typedMapFacilities.length > MAP_FACILITY_CAP;
  const mapFacilities = mapFacilitiesCapped
    ? typedMapFacilities.slice(0, MAP_FACILITY_CAP)
    : typedMapFacilities;
  const selectedFacilities = typedMapFacilities.filter(
    (facility) => facility.adm_cd2 === selectedRegionCode,
  );

  const filteredRanked = useMemo(() => {
    if (!analysis) return [];
    const q = resultSearch.trim().toLowerCase();
    if (!q) return analysis.ranked;
    return analysis.ranked.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.district.toLowerCase().includes(q) ||
        row.code.includes(q),
    );
  }, [analysis, resultSearch]);

  const filteredFacilitiesList = useMemo(() => {
    if (!analysis) return [];
    const q = resultSearch.trim().toLowerCase();
    let list = analysis.filteredFacilities;
    if (q) {
      list = list.filter(
        (facility) =>
          facility.name.toLowerCase().includes(q) ||
          facility.adm_nm.toLowerCase().includes(q) ||
          facility.type.includes(q),
      );
    }
    const sorted = [...list];
    if (facilitySort === "type") {
      sorted.sort(
        (a, b) =>
          a.type.localeCompare(b.type, "ko") || a.name.localeCompare(b.name, "ko"),
      );
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return sorted;
  }, [analysis, facilitySort, resultSearch]);

  const visibleRanked = filteredRanked.slice(0, resultLimit);
  const visibleFacilities = filteredFacilitiesList.slice(0, resultLimit);
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

  const drillIntoDistrict = useCallback(
    (districtLabel: string) => {
      if (!snapshot) return;
      const token = districtLabel.replace(/^부산광역시\s+/, "").trim();
      const intent: AnalysisIntent = {
        tool: "rankHospitalScarcity",
        filters: { regions: [token], limit: Math.min(snapshot.regions.length, 600) },
      };
      const result = executeAnalysisIntent(intent, snapshot);
      const view = resultToView("scarcity", result, `${token} 동 순위 (의료 취약)`);
      setCustomAnalysis(view);
      setActiveQuick("scarcity");
      setLastIntent(intent);
      setDrillTrail((trail) => [...trail, token]);
      if (view.ranked[0]) setSelectedRegionCode(view.ranked[0].code);
      setSheetMode("right");
      showToast(`${token} 동으로 드릴다운`);
    },
    [showToast, snapshot],
  );

  const exitDrill = useCallback(() => {
    if (!snapshot) return;
    setDrillTrail([]);
    setActiveQuick("compare");
    setCustomAnalysis(null);
    setLastIntent({ tool: "compareRegions", filters: { compare: [...comparePair] } });
    const next = executeQuickAnalysis(snapshot, "compare", radiusKm, comparePair, sidoScope);
    if (next.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
    showToast("구 비교로 돌아감");
  }, [comparePair, radiusKm, showToast, sidoScope, snapshot]);

  const applyComparePair = useCallback(
    (nextA: string, nextB: string, scope: CompareScope = compareScope) => {
      if (!snapshot) return;
      const pool =
        scope === "dong" ? listDongLabels(snapshot.regions) : listDistricts(snapshot.regions);
      const pair = normalizeComparePair(nextA, nextB, pool);
      setComparePair(pair);
      setCompareScope(scope);
      setActiveQuick("compare");
      setCustomAnalysis(null);
      setDrillTrail([]);
      setLastIntent({ tool: "compareRegions", filters: { compare: [...pair] } });
      const next = executeQuickAnalysis(snapshot, "compare", radiusKm, pair, sidoScope);
      if (next.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
      setSheetMode("right");
      showToast(`${pair[0]} vs ${pair[1]}`);
    },
    [compareScope, radiusKm, showToast, sidoScope, snapshot],
  );

  const onSheetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      sheetDragRef.current = { startY: event.clientY, startH: sheetHeight };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [sheetHeight],
  );

  const onSheetPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sheetDragRef.current) return;
    const delta = sheetDragRef.current.startY - event.clientY;
    const vh = window.innerHeight || 800;
    const next = Math.max(36, Math.min(92, sheetDragRef.current.startH + (delta / vh) * 100));
    setSheetHeight(next);
  }, []);

  const onSheetPointerUp = useCallback(() => {
    if (!sheetDragRef.current) return;
    // Mobile sheet snaps: close · peek · half · full
    const snaps = [40, 56, 78] as const;
    if (sheetHeight < 36) {
      setSheetMode("none");
      setSheetHeight(56);
      showToast("패널 닫힘");
    } else {
      const nearest = snaps.reduce((best, value) =>
        Math.abs(value - sheetHeight) < Math.abs(best - sheetHeight) ? value : best,
      );
      setSheetHeight(nearest);
    }
    sheetDragRef.current = null;
  }, [sheetHeight, showToast]);

  const setSheetSnap = useCallback((value: 40 | 56 | 78) => {
    setSheetHeight(value);
    setSheetMode((mode) => (mode === "none" ? "right" : mode));
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
        sido: sidoScope,
      });
      const next = `${window.location.pathname}${search}`;
      window.history.replaceState(null, "", next);
    },
    [activeTab, markerScope, radiusKm, sidoScope],
  );

  const copyShareLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareNotice("공유 링크를 복사했습니다.");
      showToast("공유 링크 복사됨");
    } catch {
      setShareNotice("링크 복사에 실패했습니다. 주소창 URL을 복사하세요.");
      showToast("링크 복사 실패");
    }
    window.setTimeout(() => setShareNotice(null), 2500);
  }, [showToast]);

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
          sido: sidoBadge(facility.adm_nm) ?? "",
          name: facility.name,
          type: facility.type,
          region: facility.adm_nm,
          address: facility.address ?? "",
        })),
      );
      downloadTextFile(`ralphton-facilities-${stamp}.csv`, csv);
      showToast("시설 CSV 저장");
      return;
    }
    const csv = rankedToCsv(
      analysis.title,
      stamp,
      dataSource,
      snapshot.mode,
      analysis.ranked.map((row, index) => {
        const adm =
          snapshot.regions.find((region) => region.adm_cd2 === row.code)?.adm_nm ?? row.name;
        return {
          rank: index + 1,
          code: row.code,
          sido: sidoBadge(adm) ?? "",
          name: row.name,
          valueLabel: row.valueLabel,
          note: row.note,
        };
      }),
    );
    downloadTextFile(`ralphton-rank-${stamp}.csv`, csv);
    showToast("순위 CSV 저장");
  }, [analysis, dataSource, showToast, snapshot]);

  const applyLayoutPreset = useCallback(
    (id: LayoutPresetId) => {
      setLayoutPreset(id);
      applyPreset(id);
      showToast(`레이아웃: ${LAYOUT_PRESETS[id].label}`);
    },
    [applyPreset, showToast],
  );

  const runQuick = useCallback(
    (id: QuickId) => {
      if (id === "reset") {
        setActiveQuick("scarcity");
        const next = snapshot
          ? executeQuickAnalysis(snapshot, "scarcity", 2, comparePair, sidoScope)
          : null;
        setSelectedRegionCode(next?.ranked[0]?.code ?? snapshot?.regions[0]?.adm_cd2 ?? null);
        setRadiusKm(2);
        setQuery("");
        setQueryNotice(null);
        setQueryNoticeTone("neutral");
        setQuerySuggestions([]);
        setCustomAnalysis(null);
        setSelectedFacilityId(null);
        setDrillTrail([]);
        setResultLimit(RESULT_PAGE_STEP);
        setResultSearch("");
        return;
      }
      setActiveQuick(id);
      setCustomAnalysis(null);
      setSelectedFacilityId(null);
      setResultLimit(RESULT_PAGE_STEP);
      setResultSearch("");
      if (id !== "compare") setDrillTrail([]);
      if (id === "compare") {
        setLastIntent({ tool: "compareRegions", filters: { compare: [...comparePair] } });
      }
      const next = snapshot
        ? executeQuickAnalysis(snapshot, id, radiusKm, comparePair, sidoScope)
        : null;
      if (next?.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
      else if (next?.filteredFacilities[0]) {
        setSelectedRegionCode(next.filteredFacilities[0].adm_cd2);
        setSelectedFacilityId(next.filteredFacilities[0].id);
      }
      setActiveTab("control");
      if (id === "compare") setSheetMode("right");
    },
    [comparePair, radiusKm, sidoScope, snapshot],
  );

  const runRadius = useCallback(
    (radius: 1 | 2 | 3) => {
      setRadiusKm(radius);
      setActiveQuick("radius");
      setCustomAnalysis(null);
      setSelectedFacilityId(null);
      const next = snapshot
        ? executeQuickAnalysis(snapshot, "radius", radius, comparePair, sidoScope)
        : null;
      setSelectedRegionCode(next?.ranked[0]?.code ?? selectedRegionCode);
    },
    [comparePair, selectedRegionCode, sidoScope, snapshot],
  );

  const changeSidoScope = useCallback(
    (next: SidoScope) => {
      setSidoScope(next);
      setCustomAnalysis(null);
      setResultLimit(RESULT_PAGE_STEP);
      setResultSearch("");
      try {
        window.localStorage.setItem(SIDO_SCOPE_KEY, next);
      } catch {
        /* ignore */
      }
      showToast(`지도 범위: ${SIDO_SCOPE_LABEL[next]}`);
    },
    [showToast],
  );

  const clearRecentQueries = useCallback(() => {
    setRecentQueries([]);
    try {
      window.localStorage.removeItem(RECENT_QUERIES_KEY);
    } catch {
      /* ignore */
    }
    showToast("최근 질문 삭제");
  }, [showToast]);

  const copyOneLineConclusion = useCallback(async () => {
    if (!oneLineConclusion) return;
    try {
      await navigator.clipboard.writeText(oneLineConclusion);
      showToast("한 줄 결론 복사됨");
    } catch {
      showToast("복사 실패");
    }
  }, [oneLineConclusion, showToast]);

  const submitQuery = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsParsing(true);
    setParseStage("intent");
    setQueryNotice("의도 파악 중…");
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
        setParseStage("idle");
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

      setParseStage("analyze");
      setQueryNotice("분석 실행 중…");

      const selectedName =
        snapshot.regions.find((region) => region.adm_cd2 === selectedRegionCode)?.adm_nm ?? null;
      let mergedIntent = applyFollowUpMerge(
        trimmed,
        data.intent,
        lastIntent,
        selectedRegionCode,
        selectedName,
      );
      // Map/analysis sido chip scopes NL results when the parser left regions open.
      const scopedRegionsFilter = applySidoScopeToRegions(
        mergedIntent.filters?.regions,
        sidoScope,
      );
      if (scopedRegionsFilter) {
        mergedIntent = {
          ...mergedIntent,
          filters: { ...mergedIntent.filters, regions: scopedRegionsFilter },
        };
      }

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
      setParseStage("done");
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
      setParseStage("idle");
      setQueryNotice("오프라인 상태입니다. 빠른 분석은 계속 사용할 수 있습니다.");
      setQueryNoticeTone("error");
      setQuerySuggestions([...QUERY_SUGGESTIONS].slice(0, 4));
    } finally {
      setIsParsing(false);
      window.setTimeout(() => setParseStage("idle"), 1200);
    }
  };

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface-0,#f1f5f9)] p-6">
        <section
          className="max-w-md rounded-3xl border border-rose-200 bg-[var(--surface-2,#fff)] p-8 text-center shadow-xl"
          role="alert"
        >
          <h1 className="text-lg font-bold text-slate-950">지도를 준비하지 못했습니다</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
          <button
            type="button"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm"
            data-testid="reload-data"
            onClick={() => {
              setLoadError(null);
              setSnapshot(null);
              setBoundary(null);
              setReloadToken((value) => value + 1);
            }}
          >
            다시 불러오기
          </button>
        </section>
      </main>
    );
  }

  if (!snapshot || !boundary || !analysis) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[var(--surface-0,#e7edf3)] p-6"
        aria-busy="true"
      >
        <div className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-[var(--surface-2,#fff)] p-6 shadow-lg">
          <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-slate-200" />
          <div className="mb-2 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200" />
          <p className="mt-5 text-center text-sm font-medium text-slate-600">부산·경남 공간 데이터를 준비하는 중…</p>
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

  const shellStyle = {
    ...cssVars,
    ["--sheet-height" as string]: `${sheetHeight}dvh`,
  };

  return (
    <main className="copilot-shell" style={shellStyle}>
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
        <div
          className="sheet-handle"
          onPointerDown={onSheetPointerDown}
          onPointerMove={onSheetPointerMove}
          onPointerUp={onSheetPointerUp}
          onPointerCancel={onSheetPointerUp}
          aria-label="패널 높이 조절"
          role="slider"
          aria-valuemin={36}
          aria-valuemax={92}
          aria-valuenow={Math.round(sheetHeight)}
        >
          <span className="sheet-handle-bar" />
        </div>
        <div className="sheet-snap-bar" role="group" aria-label="시트 높이 단계">
          {(
            [
              [40, "낮게"],
              [56, "중간"],
              [78, "높게"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`sheet-snap-btn ${sheetHeight === value ? "is-active" : ""}`}
              aria-pressed={sheetHeight === value}
              onClick={() => setSheetSnap(value)}
            >
              {label}
            </button>
          ))}
        </div>
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
                <h1 className="ui-title truncate text-slate-950">부산·경남 AI GIS</h1>
                <p className="ui-chip mt-0.5 text-slate-500">
                  {snapshot.mode === "live" ? "실데이터" : "시연 데이터"} · {snapshot.referenceMonth} ·{" "}
                  {snapshot.regions.length.toLocaleString("ko-KR")}동
                </p>
              </div>
            </div>
            <span
              className={`ui-status ${snapshot.mode === "live" ? "ui-status-live" : "ui-status-demo"}`}
              title={modeBadgeLabel(snapshot.mode)}
            >
              {snapshot.mode === "live" ? "실데이터" : "시연"}
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
                className={`rounded-[9px] px-2 py-2 ui-body font-semibold transition hover:text-slate-800 ${
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
            <div className="space-y-5">
              <section>
                <h2 className="section-label">1. 질문하기</h2>
                <form className="relative" onSubmit={submitQuery}>
                  <label htmlFor="analysis-query" className="sr-only">
                    분석 질의
                  </label>
                  <input
                    id="analysis-query"
                    ref={queryInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="예: 창원 의료 취약 어디? 해운대 고령 밀집?"
                    maxLength={1000}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-12 ui-body-lg shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="submit"
                    aria-label="질의 실행"
                    disabled={isParsing || !query.trim()}
                    className="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-[10px] bg-blue-600 ui-body font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-200"
                  >
                    {isParsing ? "…" : "↑"}
                  </button>
                </form>
                <div className="chip-scroll mt-2.5" aria-label="추천 질문">
                  {QUERY_SUGGESTIONS.slice(0, 6).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="ui-chip shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                      onClick={() => {
                        setQuery(item);
                        queryInputRef.current?.focus();
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                {parseStage === "intent" || parseStage === "analyze" ? (
                  <div
                    className="mt-2.5 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2.5 ui-body text-blue-800"
                    role="status"
                    data-testid="parse-stage"
                  >
                    <span className="inline-block size-1.5 animate-pulse rounded-full bg-blue-500" />
                    {parseStage === "intent" ? "질문을 이해하는 중…" : "분석을 실행하는 중…"}
                  </div>
                ) : null}
                {queryNotice ? (
                  <p
                    role="status"
                    aria-live={queryNoticeTone === "error" ? "assertive" : "polite"}
                    data-testid="query-notice"
                    className={`mt-2.5 rounded-lg px-3 py-2.5 ui-body ${
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
                        className="ui-chip rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-blue-300 hover:text-blue-700"
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
                  <div className="mt-3" data-testid="recent-queries">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="ui-caption">최근 질문</p>
                      <button
                        type="button"
                        className="ui-caption font-bold text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline"
                        data-testid="clear-recent-queries"
                        onClick={clearRecentQueries}
                      >
                        지우기
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {recentQueries.slice(0, 4).map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="ui-chip max-w-full truncate rounded-full border border-slate-100 bg-slate-50 px-3 py-1.5 text-slate-600 hover:border-blue-300 hover:bg-white hover:text-blue-700"
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
                <h2 className="section-label">2. 빠른 분석</h2>
                <p className="ui-caption mb-2 -mt-1">클릭 한 번으로 바로 결과 확인</p>
                <div className="grid grid-cols-2 gap-2">
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
                      className={`quick-tile min-h-[64px] rounded-xl border p-2.5 text-left transition active:scale-[.98] ${
                        activeQuick === item.id && item.id !== "reset"
                          ? "border-blue-300 bg-blue-50/60 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className={`inline-grid size-7 place-items-center rounded-md text-sm font-bold ${item.tone}`}>
                        {item.symbol}
                      </span>
                      <span className="mt-1.5 block ui-body font-bold text-slate-900">{item.label}</span>
                      <span className="ui-caption mt-0.5 block text-slate-500">
                        {item.id === "compare"
                          ? `${comparePair[0]} · ${comparePair[1]}`
                          : item.subtitle}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {(activeQuick === "compare" || lastIntent?.tool === "compareRegions") && (
                <section
                  className="rounded-xl border border-amber-200 bg-amber-50/70 p-3"
                  data-testid="compare-picker"
                >
                  <p className="ui-body font-bold text-amber-950">비교 대상</p>
                  <p className="ui-caption mt-1 text-amber-900/80">
                    구·군 합산 또는 행정동 1:1 비교
                  </p>
                  <div className="mt-2 flex gap-1">
                    {(
                      [
                        ["gu", "구·군"],
                        ["dong", "행정동"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={compareScope === id}
                        className={`flex-1 rounded-lg py-2 ui-chip font-bold ${
                          compareScope === id
                            ? "bg-amber-900 text-white"
                            : "bg-white text-amber-950 border border-amber-200"
                        }`}
                        onClick={() => {
                          const pool =
                            id === "dong"
                              ? dongOptions
                              : districtOptions;
                          if (pool.length < 2) return;
                          const next = normalizeComparePair(pool[0], pool[1], pool);
                          applyComparePair(next[0], next[1], id);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="ui-caption mb-1 block">A</span>
                      <select
                        className="w-full rounded-lg border border-amber-200 bg-white px-2 py-2 ui-body font-bold text-slate-900"
                        value={
                          compareOptions.includes(comparePair[0])
                            ? comparePair[0]
                            : (compareOptions[0] ?? "")
                        }
                        aria-label="비교 지역 A"
                        onChange={(event) =>
                          applyComparePair(event.target.value, comparePair[1], compareScope)
                        }
                      >
                        {compareOptions.map((name) => (
                          <option key={`a-${name}`} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="ui-caption mb-1 block">B</span>
                      <select
                        className="w-full rounded-lg border border-amber-200 bg-white px-2 py-2 ui-body font-bold text-slate-900"
                        value={
                          compareOptions.includes(comparePair[1])
                            ? comparePair[1]
                            : (compareOptions[1] ?? compareOptions[0] ?? "")
                        }
                        aria-label="비교 지역 B"
                        onChange={(event) =>
                          applyComparePair(comparePair[0], event.target.value, compareScope)
                        }
                      >
                        {compareOptions.map((name) => (
                          <option key={`b-${name}`} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {compareScope === "gu" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(
                        [
                          ["기장군", "강서구"],
                          ["해운대구", "부산진구"],
                          ["창원시", "김해시"],
                          ["진주시", "양산시"],
                          ["중구", "영도구"],
                        ] as const
                      )
                        .filter(
                          ([a, b]) =>
                            districtOptions.includes(a) && districtOptions.includes(b),
                        )
                        .map(([a, b]) => (
                          <button
                            key={`${a}-${b}`}
                            type="button"
                            className="ui-chip rounded-full border border-amber-300 bg-white px-2.5 py-1 font-bold text-amber-950"
                            onClick={() => applyComparePair(a, b, "gu")}
                          >
                            {a.replace(/[구현군]$/, "")}·{b.replace(/[구현군]$/, "")}
                          </button>
                        ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dongOptions
                        .slice(0, 6)
                        .reduce<Array<[string, string]>>((pairs, label, index, list) => {
                          if (index % 2 === 0 && list[index + 1]) {
                            pairs.push([label, list[index + 1]]);
                          }
                          return pairs;
                        }, [])
                        .map(([a, b]) => (
                          <button
                            key={`${a}-${b}`}
                            type="button"
                            className="ui-chip max-w-full truncate rounded-full border border-amber-300 bg-white px-2.5 py-1 font-bold text-amber-950"
                            title={`${a} vs ${b}`}
                            onClick={() => applyComparePair(a, b, "dong")}
                          >
                            {a.split(" ").slice(-1)[0]}·{b.split(" ").slice(-1)[0]}
                          </button>
                        ))}
                    </div>
                  )}
                </section>
              )}

              <section>
                <h2 className="section-label">3. 접근 반경</h2>
                <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
                  {([1, 2, 3] as const).map((radius) => (
                    <button
                      key={radius}
                      type="button"
                      aria-label={`${radius}km 반경`}
                      aria-pressed={radiusKm === radius}
                      className={`flex-1 rounded-lg py-2.5 ui-body font-bold ${
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

              {selectedRegion && lastIntent ? (
                <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="ui-caption font-bold text-blue-800">이어서 묻기</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[
                      "이 동만 병원 보여줘",
                      "반경 3km로",
                      "이 결과에서 약국만",
                    ].map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="ui-chip rounded-full border border-blue-200 bg-white px-2.5 py-1 text-blue-900"
                        onClick={() => setQuery(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <details className="ui-details">
                <summary>지도 표시 옵션</summary>
                <div className="ui-details-body space-y-3">
                  <div>
                    <p className="ui-caption mb-1.5">마커 범위</p>
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
                          className={`flex-1 rounded-lg py-2 ui-chip font-bold ${
                            markerScope === id ? "bg-slate-900 text-white" : "text-slate-500"
                          }`}
                          onClick={() => setMarkerScope(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="ui-caption mb-1.5">시설 유형</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={`ui-chip rounded-full px-2.5 py-1 font-bold ${
                          facilityTypeFilter === "all"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                        onClick={() => setFacilityTypeFilter("all")}
                      >
                        전체
                      </button>
                      {Object.entries(FACILITY_TYPE_COLORS).map(([type, color]) => (
                        <button
                          key={type}
                          type="button"
                          className={`ui-chip rounded-full px-2.5 py-1 font-bold ${
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
                  </div>
                </div>
              </details>

              <details className="ui-details">
                <summary>화면 설정</summary>
                <div className="ui-details-body space-y-3">
                  <div>
                    <p className="ui-caption mb-1.5">패널 배치</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(Object.keys(LAYOUT_PRESETS) as LayoutPresetId[]).map((id) => (
                        <button
                          key={id}
                          type="button"
                          title={LAYOUT_PRESETS[id].hint}
                          aria-pressed={layoutPreset === id}
                          className={`rounded-lg border px-2 py-2 text-left ui-chip font-bold transition ${
                            layoutPreset === id
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                          }`}
                          onClick={() => applyLayoutPreset(id)}
                        >
                          {LAYOUT_PRESETS[id].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="ui-caption mb-1.5">글자·여백 밀도</p>
                    <div className="flex gap-1">
                      {(
                        [
                          ["comfortable", "여유"],
                          ["compact", "촘촘"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={density === id}
                          className={`flex-1 rounded-lg py-2 ui-chip font-bold ${
                            density === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => {
                            setDensity(id);
                            showToast(id === "compact" ? "촘촘한 화면" : "여유 있는 화면");
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="ui-caption mb-1.5">
                      테마{" "}
                      <span className="font-normal text-slate-400">
                        · <kbd className="kbd">Shift</kbd>+<kbd className="kbd">D</kbd>
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          ["system", "시스템"],
                          ["light", "라이트"],
                          ["dark", "다크"],
                          ["contrast", "고대비"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          data-testid={`theme-${id}`}
                          aria-pressed={themePreference === id}
                          className={`rounded-lg py-2 ui-chip font-bold ${
                            themePreference === id
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => {
                            setThemePreference(id);
                            showToast(`테마: ${label}`);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="ui-caption mt-1.5 text-slate-400" data-testid="theme-resolved">
                      화면: {THEME_LABELS[resolveTheme(themePreference)]}
                      {themePreference === "system" ? " · OS 따름" : ""}
                    </p>
                  </div>
                </div>
              </details>

              <p className="ui-caption text-center text-slate-400">
                결과는 오른쪽 패널 · 지도에서 동을 눌러 자세히 보기
              </p>
            </div>
          ) : activeTab === "help" ? (
            <div className="space-y-4">
              <div>
                <p className="ui-title text-slate-900">이렇게 쓰세요</p>
                <ol className="mt-3 list-decimal space-y-2.5 pl-5 ui-body text-slate-700">
                  <li>
                    <span className="font-bold text-slate-900">질문</span> 또는{" "}
                    <span className="font-bold text-slate-900">빠른 분석</span>을 실행합니다.
                  </li>
                  <li>
                    <span className="font-bold text-slate-900">지도</span>에서 행정동·시설을 선택합니다.
                  </li>
                  <li>
                    <span className="font-bold text-slate-900">오른쪽</span>에서 순위·해석·상세를 확인합니다.
                  </li>
                </ol>
              </div>

              <section
                className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5"
                data-testid="evaluator-guide"
              >
                <p className="ui-body font-bold text-blue-950">평가자 점검 가이드</p>
                <p className="ui-caption mt-1 text-blue-900/80">
                  제출 데모 기준 · 약 3분 시나리오
                </p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 ui-body text-blue-950/90">
                  {EVALUATOR_SCRIPT.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <details className="mt-3 rounded-lg border border-blue-100 bg-white/80">
                  <summary className="cursor-pointer px-3 py-2 ui-chip font-bold text-blue-900">
                    평가 항목 체크리스트
                  </summary>
                  <ul className="space-y-2 border-t border-blue-50 px-3 py-2">
                    {EVALUATOR_CRITERIA.map((item) => (
                      <li key={item.id} className="ui-body text-slate-700">
                        <span className="font-bold text-slate-900">
                          {item.title}
                        </span>{" "}
                        <span className="ui-caption text-slate-500">({item.weight})</span>
                        <p className="ui-caption mt-0.5 text-slate-600">확인: {item.lookFor}</p>
                        <p className="ui-caption text-blue-800">검증: {item.howToVerify}</p>
                      </li>
                    ))}
                  </ul>
                </details>
                <p className="ui-caption mt-2 rounded-lg bg-white/70 px-2.5 py-2 font-semibold text-slate-700">
                  산식 요약: {METHOD_SUMMARY}
                </p>
              </section>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="ui-body font-bold text-slate-900">자주 쓰는 조작</p>
                <ul className="mt-2 space-y-2 ui-body text-slate-600">
                  <li>
                    <span className="kbd">/</span> 질문 입력으로 이동
                  </li>
                  <li>
                    <span className="kbd">↑</span>
                    <span className="kbd">↓</span> 순위 목록 이동
                  </li>
                  <li>
                    <span className="kbd">[</span>
                    <span className="kbd">]</span> 좌·우 패널 접기
                  </li>
                  <li>구 비교 결과 → 「동 순위 보기」로 한 단계 더</li>
                </ul>
                <details className="mt-3">
                  <summary className="ui-chip cursor-pointer font-bold text-slate-500">더 많은 단축키</summary>
                  <ul className="mt-2 space-y-1.5 ui-chip text-slate-500">
                    <li>
                      <span className="kbd">\</span> 지도만 넓게 보기
                    </li>
                    <li>
                      <span className="kbd">Shift+0</span> 패널 크기 초기화
                    </li>
                    <li>
                      <span className="kbd">Shift+D</span> 테마 순환 (시스템→라이트→다크→고대비)
                    </li>
                    <li>
                      <span className="kbd">1</span>/<span className="kbd">2</span>/
                      <span className="kbd">3</span> 범위 전체·부산·경남
                    </li>
                    <li>
                      <span className="kbd">j</span>/<span className="kbd">k</span> 순위 이동 (대안)
                    </li>
                  </ul>
                </details>
              </div>

              <div className="rounded-xl bg-slate-900 p-3.5 text-white">
                <p className="ui-caption font-bold text-blue-300">바로 써볼 질문</p>
                {QUERY_SUGGESTIONS.slice(0, 6).map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="mt-2 block w-full rounded-lg bg-white/10 px-3 py-2 text-left ui-body text-slate-100 hover:bg-white/15"
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
            <div className="space-y-4">
              <div
                className={`rounded-xl border p-3.5 ${
                  snapshot.mode === "live"
                    ? "border-emerald-100 bg-emerald-50 text-emerald-950"
                    : "border-amber-100 bg-amber-50 text-amber-950"
                }`}
                data-testid="data-mode-banner"
              >
                <p className="ui-body font-bold">
                  {snapshot.mode === "live"
                    ? "지금 실데이터 스냅샷을 보고 있습니다"
                    : "지금 시연용 데이터를 보고 있습니다"}
                </p>
                <p className="ui-body mt-1.5 opacity-90">
                  {snapshot.mode === "live"
                    ? "기준월과 출처 노트를 함께 확인하세요. 시설·인구 원천이 다를 수 있습니다."
                    : "시연 합성 데이터입니다. 정책 판단·대외 수치 인용에 사용하지 마세요. 실데이터는 동기화 후 live 스냅샷으로 전환됩니다."}
                </p>
                <p className="ui-caption mt-2 font-semibold opacity-95">
                  범위: 부산·경남 · 산식: 공급35+고령25+거리25+2km무시설15
                </p>
                {populationNoteFromSnapshot(snapshot.sourceNotes) ? (
                  <p className="ui-chip mt-2 font-bold opacity-95" data-testid="population-live-note">
                    {populationNoteFromSnapshot(snapshot.sourceNotes)}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ["기준월", snapshot.referenceMonth],
                  [
                    "행정동",
                    `${snapshot.regions.length.toLocaleString("ko-KR")}개`,
                  ],
                  [
                    "부산 / 경남 동",
                    `${sidoMix.busan.toLocaleString("ko-KR")} / ${sidoMix.gyeongnam.toLocaleString("ko-KR")}`,
                  ],
                  [
                    "부산 / 경남 시설",
                    `${facilitySidoMix.busan.toLocaleString("ko-KR")} / ${facilitySidoMix.gyeongnam.toLocaleString("ko-KR")}`,
                  ],
                  ["시설", `${snapshot.facilities.length.toLocaleString("ko-KR")}곳`],
                  ["지도", mapEngineLabel(kakaoMapKey, mapEngine)],
                  ["병원 API", "HIRA v2"],
                  ["화면 범위", SIDO_SCOPE_LABEL[sidoScope]],
                  ["지도 시설 상한", `${MAP_FACILITY_CAP.toLocaleString("ko-KR")}곳`],
                ].map(([label, value]) => (
                  <div key={label} className="ui-stat-card">
                    <p className="label">{label}</p>
                    <p className="value">{value}</p>
                  </div>
                ))}
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-3.5" data-testid="facility-type-breakdown">
                <p className="ui-body font-bold text-slate-800">시설 유형 분포</p>
                <p className="ui-caption mt-1 mb-2">현재 스냅샷 기준 · 약국 포함</p>
                <ul className="space-y-1.5">
                  {(() => {
                    const counts = new Map<string, number>();
                    for (const facility of snapshot.facilities) {
                      counts.set(facility.type, (counts.get(facility.type) ?? 0) + 1);
                    }
                    return [...counts.entries()]
                      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
                      .map(([type, count]) => (
                        <li
                          key={type}
                          className="flex items-center justify-between gap-2 ui-body text-slate-700"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: FACILITY_TYPE_COLORS[type as Facility["type"]] ?? "#64748b",
                              }}
                              aria-hidden
                            />
                            <span className="truncate">{type}</span>
                          </span>
                          <span className="font-bold tabular-nums">
                            {count.toLocaleString("ko-KR")}
                          </span>
                        </li>
                      ));
                  })()}
                </ul>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="ui-body font-bold text-slate-800">데이터 소스 선택</p>
                <p className="ui-caption mt-1 mb-2">실데이터가 있으면 자동으로 우선합니다</p>
                <div className="flex gap-1">
                  {(
                    [
                      ["auto", "자동"],
                      ["demo", "시연만"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`flex-1 rounded-lg py-2.5 ui-body font-bold ${
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

              {syncOps ? (
                <div
                  className={`rounded-xl border px-3.5 py-3 ${
                    syncOps.stale || syncOps.recommendSync
                      ? "border-amber-200 bg-amber-50 text-amber-950"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                  data-testid="sync-ops-status"
                  role="status"
                >
                  <p className="ui-body font-bold">
                    동기화{" "}
                    {syncOps.stale || syncOps.recommendSync ? "· 갱신 권장" : "· 정상"}
                  </p>
                  <p className="ui-body mt-1.5">
                    최근 결과: {formatSyncStatusLabel(syncOps.lastStatus)}
                    {syncOps.lastFacilityCount != null
                      ? ` · 시설 ${syncOps.lastFacilityCount.toLocaleString("ko-KR")}곳`
                      : ""}
                  </p>
                  {syncOps.lastAttemptAt ? (
                    <p className="ui-chip mt-1 text-slate-600">
                      최근 시도 {new Date(syncOps.lastAttemptAt).toLocaleString("ko-KR")}
                    </p>
                  ) : (
                    <p className="ui-chip mt-1 text-slate-500">아직 동기화 기록이 없습니다</p>
                  )}
                  {syncOps.reason ? (
                    <p className="ui-body mt-1.5 font-medium">{syncOps.reason}</p>
                  ) : null}
                  {syncOps.lastError ? (
                    <p className="ui-body mt-1 text-rose-700">오류: {syncOps.lastError}</p>
                  ) : null}
                </div>
              ) : null}

              {capabilities ? (
                <details className="ui-details">
                  <summary>연결 상태 · 기술 정보</summary>
                  <div className="ui-details-body space-y-3">
                    <ul className="space-y-2 ui-body">
                      {(
                        [
                          ["Kakao 지도", capabilities.kakaoMapsJs],
                          ["Kakao 장소검색", capabilities.kakaoRest],
                          ["AI 질문 해석", capabilities.qwen],
                          ["공공데이터", capabilities.publicData],
                          ["인구 live 병합", Boolean(capabilities.populationLive)],
                          ["RAG 원격 임베딩", Boolean(capabilities.ragRemoteEmbed)],
                          ["Supabase", capabilities.supabase],
                          ["시설 동기화", capabilities.dataSync],
                          ["cron 실패 알림", Boolean(capabilities.cronAlert)],
                        ] as const
                      ).map(([label, on]) => (
                        <li key={label} className="flex items-center justify-between gap-2">
                          <span className="text-slate-600">{label}</span>
                          <span className={`font-bold ${on ? "text-emerald-600" : "text-slate-400"}`}>
                            {on ? "연결됨" : "미설정"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {publishedLive?.available ? (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 ui-body text-emerald-900">
                        <p className="font-bold">게시된 실데이터</p>
                        <p className="mt-1">기준월 {publishedLive.referenceMonth ?? "—"}</p>
                        <p>
                          갱신{" "}
                          {publishedLive.createdAt
                            ? new Date(publishedLive.createdAt).toLocaleString("ko-KR")
                            : "시각 없음"}
                        </p>
                        <p>시설 {publishedLive.facilityCount?.toLocaleString("ko-KR") ?? "—"}곳</p>
                      </div>
                    ) : (
                      <p className="ui-body text-slate-500">
                        게시된 실데이터 스냅샷이 없습니다.
                      </p>
                    )}
                    {publishedAt ? (
                      <p className="ui-caption">
                        현재 화면 로드: {new Date(publishedAt).toLocaleString("ko-KR")}
                      </p>
                    ) : null}
                    <p className="ui-caption text-slate-400">
                      경계 버전 {boundaryVersion} · {dataSourceLabel(dataSource)}
                    </p>
                  </div>
                </details>
              ) : null}

              {snapshot.sourceNotes.length > 0 ? (
                <details className="ui-details">
                  <summary>출처 노트</summary>
                  <div className="ui-details-body space-y-1.5">
                    {snapshot.sourceNotes.slice(0, 6).map((note) => (
                      <p key={note} className="ui-body text-slate-600">
                        · {note}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
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
          boundary={scopedBoundary ?? boundary}
          regions={scopedRegions}
          facilities={mapFacilities}
          livePlaces={livePlaces}
          scores={scores}
          selectedRegionCode={selectedRegionCode}
          focusRegionCodes={focusRegionCodes}
          radiusKm={radiusKm}
          showFacilities={analysis.isFacilityResult}
          legendLabel={analysis.legendLabel}
          onSelectRegion={selectRegion}
          onSelectFacility={selectFacility}
          onSelectLivePlace={selectLivePlace}
          onEngineChange={setMapEngine}
        />

        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-2xl border border-white/80 bg-white/90 px-4 py-2.5 shadow-lg backdrop-blur max-md:left-3 max-md:translate-x-0">
          <div className="pointer-events-auto mb-1.5 flex gap-1">
            {(
              [
                ["all", "전체"],
                ["busan", "부산"],
                ["gyeongnam", "경남"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`sido-scope-${id}`}
                className={`rounded-lg px-2 py-0.5 ui-caption font-bold transition ${
                  sidoScope === id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                onClick={() => changeSidoScope(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {mapFacilitiesCapped ? (
            <p className="ui-caption mb-1 font-semibold text-amber-700">
              지도 시설 {MAP_FACILITY_CAP}개 표시 · 전체 {typedMapFacilities.length.toLocaleString("ko-KR")}
            </p>
          ) : null}
          <p className="ui-caption font-bold text-blue-600">{analysis.title}</p>
          <p className="max-w-[260px] truncate ui-body font-bold text-slate-900">
            {selectedRegion
              ? compactName(selectedRegion)
              : sidoScope === "busan"
                ? "부산광역시"
                : sidoScope === "gyeongnam"
                  ? "경상남도"
                  : "부산·경남"}
          </p>
          {isCompareView && focusRegionCodes ? (
            <p className="ui-caption mt-1 font-bold text-amber-800">
              비교 강조 · {comparePair[0]} · {comparePair[1]}
            </p>
          ) : null}
        </div>

        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 max-md:bottom-20">
          <div className="map-float-bar">
            <button
              type="button"
              className="mobile-panel-btn !m-0 !shadow-none"
              onClick={() => setSheetMode((mode) => (mode === "left" ? "none" : "left"))}
            >
              조작
            </button>
            <button
              type="button"
              className="mobile-panel-btn !m-0 !shadow-none"
              onClick={() => setSheetMode((mode) => (mode === "right" ? "none" : "right"))}
            >
              결과
            </button>
            <button
              type="button"
              className="map-float-btn hidden md:inline-flex"
              title="지도 넓게 ( \\ )"
              onClick={() => applyLayoutPreset("map")}
            >
              지도 넓게
            </button>
            <button
              type="button"
              className="map-float-btn hidden md:inline-flex"
              title="분석 집중"
              onClick={() => applyLayoutPreset("analyze")}
            >
              분석 넓게
            </button>
            <button
              type="button"
              className="map-float-btn hidden md:inline-flex"
              title="결과 집중"
              onClick={() => applyLayoutPreset("results")}
            >
              결과 넓게
            </button>
            <button
              type="button"
              className="map-float-btn hidden md:inline-flex"
              title="균형 레이아웃"
              onClick={() => applyLayoutPreset("balanced")}
            >
              균형
            </button>
            <button
              type="button"
              className="map-float-btn hidden md:inline-flex"
              title="레이아웃 초기화 (Shift+0)"
              onClick={() => {
                resetLayout();
                setLayoutPreset("balanced");
                showToast("레이아웃 초기화");
              }}
            >
              레이아웃
            </button>
            <button
              type="button"
              className="map-float-btn"
              data-testid="theme-cycle-btn"
              title={`테마 전환 (Shift+D) · 현재 ${THEME_LABELS[themePreference]}`}
              aria-label={`테마 전환, 현재 ${THEME_LABELS[themePreference]}`}
              onClick={() => {
                setThemePreference((current) => {
                  const next = cycleThemePreference(current);
                  showToast(`테마: ${THEME_LABELS[next]}`);
                  return next;
                });
              }}
            >
              {resolveTheme(themePreference) === "dark"
                ? "다크"
                : resolveTheme(themePreference) === "contrast"
                  ? "고대비"
                  : themePreference === "system"
                    ? "시스템"
                    : "라이트"}
            </button>
          </div>
        </div>

        {showOnboard ? (
          <div
            className="onboard-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboard-title"
            data-testid="onboard-card"
          >
            <p className="ui-caption font-bold text-blue-300">30초 시작</p>
            <h2 id="onboard-title" className="ui-title mt-1 text-white">
              이렇게 써 보세요
            </h2>
            <ol className="mt-3 space-y-2 ui-body text-slate-200">
              <li>
                <span className="font-bold text-white">1.</span> 왼쪽에서 「의료 취약」을 누릅니다
              </li>
              <li>
                <span className="font-bold text-white">2.</span> 지도에서 행정동을 고릅니다
              </li>
              <li>
                <span className="font-bold text-white">3.</span> 오른쪽에서 순위·해석을 확인합니다
              </li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-blue-500 px-3.5 py-2 ui-chip font-bold text-white hover:bg-blue-400"
                onClick={runOnboardExample}
              >
                의료 취약 실행
              </button>
              <button
                type="button"
                className="rounded-full border border-white/30 bg-white/10 px-3.5 py-2 ui-chip font-bold text-slate-100 hover:bg-white/15"
                onClick={dismissOnboard}
              >
                바로 시작
              </button>
            </div>
          </div>
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
        <div
          className="sheet-handle"
          onPointerDown={onSheetPointerDown}
          onPointerMove={onSheetPointerMove}
          onPointerUp={onSheetPointerUp}
          onPointerCancel={onSheetPointerUp}
          aria-label="결과 패널 높이 조절"
          role="slider"
          aria-valuemin={36}
          aria-valuemax={92}
          aria-valuenow={Math.round(sheetHeight)}
        >
          <span className="sheet-handle-bar" />
        </div>
        <div className="sheet-snap-bar" role="group" aria-label="결과 시트 높이 단계">
          {(
            [
              [40, "낮게"],
              [56, "중간"],
              [78, "높게"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={`right-${value}`}
              type="button"
              className={`sheet-snap-btn ${sheetHeight === value ? "is-active" : ""}`}
              aria-pressed={sheetHeight === value}
              onClick={() => setSheetSnap(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <header className="border-b border-slate-200/80 px-4 pb-3.5 pt-4">
          <p className="section-label !mb-1 text-blue-600">결과</p>
          <h2 className="ui-display text-slate-950">{analysis.title}</h2>
          {drillTrail.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 ui-chip" data-testid="drill-trail">
              <button
                type="button"
                className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-bold text-amber-900"
                onClick={exitDrill}
              >
                구 비교로
              </button>
              {drillTrail.map((token) => (
                <span key={token} className="text-slate-500">
                  › {token}
                </span>
              ))}
            </div>
          ) : null}
          <p className="ui-body mt-1.5 text-slate-600">{analysis.summary}</p>
          {oneLineConclusion ? (
            <div className="result-conclusion mt-2.5" data-testid="one-line-conclusion">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="result-conclusion-label !mb-0">한 줄 결론</span>
                <button
                  type="button"
                  className="ui-caption font-bold text-blue-700 hover:underline"
                  data-testid="copy-conclusion"
                  onClick={() => void copyOneLineConclusion()}
                >
                  복사
                </button>
              </div>
              <p role="status" aria-live="polite">
                {oneLineConclusion}
              </p>
            </div>
          ) : null}
          <p
            className="ui-caption mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-slate-600"
            data-testid="method-summary"
          >
            <span className="font-bold text-slate-800">방법론 · </span>
            {METHOD_SUMMARY}
          </p>
          <div
            className={`mt-2.5 rounded-lg border px-3 py-2 ui-chip ${
              snapshot.mode === "live"
                ? "border-emerald-100 bg-emerald-50 text-emerald-900"
                : "border-amber-100 bg-amber-50 text-amber-900"
            }`}
            data-testid="data-provenance"
          >
            <span className="font-bold">
              {snapshot.mode === "live" ? "실데이터" : "시연 데이터"}
            </span>
            {" · "}기준월 {snapshot.referenceMonth}
            {snapshot.mode === "demo" ? " · 정책 판단용 아님" : ""}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="ui-chip rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
              {analysis.isFacilityResult
                ? `${filteredFacilitiesList.length}개 시설`
                : `${filteredRanked.length}개 동`}
            </span>
            <span className="ui-chip rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-800">
              {SIDO_SCOPE_LABEL[sidoScope]}
            </span>
            {currentRank > 0 ? (
              <span className="ui-chip rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">
                선택 {currentRank}위
              </span>
            ) : null}
            <button
              type="button"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={exportCurrentCsv}
            >
              CSV
            </button>
            <button
              type="button"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
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
              공유
            </button>
          </div>
          {shareNotice ? (
            <p className="ui-chip mt-2 font-semibold text-emerald-700" role="status">
              {shareNotice}
            </p>
          ) : null}
        </header>

        <div className="copilot-scroll space-y-4 px-3 pb-8 pt-3">
          {emptyResult ? (
            <section className="empty-state">
              <p className="ui-body-lg font-bold text-slate-800">표시할 결과가 없습니다</p>
              <p className="ui-body mt-1.5 text-slate-500">
                없는 값은 추정하지 않습니다. 아래 분석으로 다시 시작해 보세요.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {(["scarcity", "elderly", "radius"] as QuickId[]).map((id) => {
                  const item = QUICK_ANALYSES.find((quick) => quick.id === id);
                  if (!item) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="ui-chip rounded-full bg-slate-900 px-3.5 py-1.5 font-bold text-white"
                      onClick={() => runQuick(id)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-caption font-bold text-slate-500">
                  {analysis.isFacilityResult ? "시설 목록" : "상위 순위 · 지도와 연동"}
                </p>
                <p className="ui-caption text-slate-400">
                  {analysis.isFacilityResult
                    ? `${Math.min(resultLimit, filteredFacilitiesList.length)}/${filteredFacilitiesList.length}`
                    : `${Math.min(resultLimit, filteredRanked.length)}/${filteredRanked.length}`}
                </p>
              </div>
              <label className="mt-2 block">
                <span className="sr-only">결과 검색</span>
                <input
                  type="search"
                  value={resultSearch}
                  onChange={(event) => {
                    setResultSearch(event.target.value);
                    setResultLimit(RESULT_PAGE_STEP);
                  }}
                  placeholder={
                    analysis.isFacilityResult
                      ? "시설명·지역·유형 검색"
                      : "동·구·시 이름 검색"
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 ui-body outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  data-testid="result-search"
                />
              </label>
              {analysis.isFacilityResult ? (
                <div className="mt-2 flex gap-1" role="group" aria-label="시설 정렬">
                  {(
                    [
                      ["name", "이름순"],
                      ["type", "유형순"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`facility-sort-${id}`}
                      aria-pressed={facilitySort === id}
                      className={`flex-1 rounded-lg py-1.5 ui-caption font-bold ${
                        facilitySort === id
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                      onClick={() => setFacilitySort(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="divide-y divide-slate-100">
              {analysis.isFacilityResult
                ? visibleFacilities.map((facility) => (
                    <button
                      key={facility.id}
                      type="button"
                      className={`rank-row flex w-full items-center gap-2.5 px-3.5 py-3 text-left ${
                        facility.id === selectedFacilityId ? "is-selected" : ""
                      }`}
                      onPointerDown={() => selectFacility(facility)}
                      onClick={(event) => {
                        if (event.detail === 0) selectFacility(facility);
                      }}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: FACILITY_TYPE_COLORS[facility.type] ?? "#64748b" }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="rank-name block truncate">
                          {facility.name}
                          {sidoBadge(facility.adm_nm) ? (
                            <span className="ml-1.5 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                              {sidoBadge(facility.adm_nm)}
                            </span>
                          ) : null}
                        </span>
                        <span className="rank-note mt-0.5 block">
                          {facility.type} · {facility.adm_nm.replace(/^부산광역시\s*/, "").replace(/^경상남도\s*/, "")}
                        </span>
                      </span>
                    </button>
                  ))
                : visibleRanked.map((row, index) => (
                    <div
                      key={row.code}
                      className={`rank-row flex w-full flex-col gap-1.5 px-3.5 py-3 ${
                        row.code === selectedRegionCode ? "is-selected" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 text-left"
                        onPointerDown={() => selectRegion(row.code)}
                        onClick={(event) => {
                          if (event.detail === 0) selectRegion(row.code);
                        }}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full ui-chip font-black ${
                            (analysis.ranked.findIndex((item) => item.code === row.code) < 3
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-500")
                          }`}
                          title={`표시 ${index + 1} · 전체 순위 ${analysis.ranked.findIndex((item) => item.code === row.code) + 1}`}
                        >
                          {analysis.ranked.findIndex((item) => item.code === row.code) + 1 ||
                            index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="rank-name block truncate">
                            {row.name}
                            {sidoBadge(
                              snapshot.regions.find((region) => region.adm_cd2 === row.code)
                                ?.adm_nm ?? "",
                            ) ? (
                              <span className="ml-1.5 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                {sidoBadge(
                                  snapshot.regions.find((region) => region.adm_cd2 === row.code)
                                    ?.adm_nm ?? "",
                                )}
                              </span>
                            ) : null}
                          </span>
                          <span className="rank-note mt-0.5 block">{row.note}</span>
                        </span>
                        <span className="rank-value">{row.valueLabel}</span>
                      </button>
                      <span className="score-bar ml-9" aria-hidden>
                        <span style={{ width: `${Math.max(6, Math.min(100, row.mapScore))}%` }} />
                      </span>
                      {isCompareView ? (
                        <button
                          type="button"
                          className="ui-chip ml-9 self-start rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-bold text-blue-800"
                          onClick={() => drillIntoDistrict(row.name)}
                        >
                          동 순위 보기
                        </button>
                      ) : null}
                    </div>
                  ))}
              {(analysis.isFacilityResult
                ? filteredFacilitiesList.length > resultLimit
                : filteredRanked.length > resultLimit) ? (
                <button
                  type="button"
                  className="w-full border-t border-slate-100 py-2.5 ui-body font-bold text-blue-700 hover:bg-slate-50"
                  data-testid="result-load-more"
                  onClick={() => setResultLimit((value) => value + RESULT_PAGE_STEP)}
                >
                  더 보기 (
                  {(analysis.isFacilityResult
                    ? filteredFacilitiesList.length
                    : filteredRanked.length) - resultLimit}
                  개 남음)
                </button>
              ) : null}
              {!analysis.isFacilityResult && filteredRanked.length === 0 ? (
                <p className="px-3.5 py-4 ui-body text-slate-500">검색 결과가 없습니다.</p>
              ) : null}
              {analysis.isFacilityResult && filteredFacilitiesList.length === 0 ? (
                <p className="px-3.5 py-4 ui-body text-slate-500">검색 결과가 없습니다.</p>
              ) : null}
            </div>
            {analysis.formulaNotes.length ? (
              <details className="border-t border-slate-100 px-3.5 py-2.5">
                <summary className="ui-chip cursor-pointer font-bold text-slate-600">
                  산식 · 해석 기준
                </summary>
                <ul className="mt-2 space-y-1.5 ui-chip text-slate-500">
                  {analysis.formulaNotes.map((note) => (
                    <li key={note}>· {note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {interpretation ? <InterpretationCard interpretation={interpretation} /> : null}

          {selectedRegion ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <p className="ui-caption font-bold text-blue-600">선택한 행정동</p>
              <h3 className="ui-title mt-1 text-slate-950">{compactName(selectedRegion)}</h3>

              {selectedFacility ? (
                <article className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3 ui-body text-slate-700">
                  <p className="font-bold text-cyan-900">{selectedFacility.name}</p>
                  <p className="mt-1">{selectedFacility.type}</p>
                  <p className="mt-1">{selectedFacility.address ?? selectedFacility.adm_nm}</p>
                  <p className="mt-1">전화 {selectedFacility.phone ?? "데이터 없음"}</p>
                </article>
              ) : null}

              {selectedLivePlace ? (
                <article className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3 ui-body text-slate-700">
                  <p className="ui-caption font-bold text-violet-700">실시간 장소</p>
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
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedAnalysisRegion.metrics.slice(0, 4).map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                      <p className="ui-caption font-semibold text-blue-700">{metric.label}</p>
                      <p className="mt-1 ui-body-lg font-black tabular-nums text-slate-950">
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

      {/* Edge toggles: just outside each sidebar, vertical center */}
      <button
        type="button"
        className="panel-edge-toggle panel-edge-toggle-left"
        title={layout.leftCollapsed ? "조작 패널 열기 ( [ )" : "조작 패널 접기 ( [ )"}
        aria-label={layout.leftCollapsed ? "조작 패널 열기" : "조작 패널 접기"}
        aria-pressed={!layout.leftCollapsed}
        onClick={toggleLeft}
      >
        {layout.leftCollapsed ? "›" : "‹"}
      </button>
      <button
        type="button"
        className="panel-edge-toggle panel-edge-toggle-right"
        title={layout.rightCollapsed ? "결과 패널 열기 ( ] )" : "결과 패널 접기 ( ] )"}
        aria-label={layout.rightCollapsed ? "결과 패널 열기" : "결과 패널 접기"}
        aria-pressed={!layout.rightCollapsed}
        onClick={toggleRight}
      >
        {layout.rightCollapsed ? "‹" : "›"}
      </button>

      {toast ? (
        <div className="ui-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
