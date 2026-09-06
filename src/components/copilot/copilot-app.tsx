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
  resolveExportProvenance,
} from "@/lib/analysis/export-csv";
import { dataModeLabel, dataModeTitle, populationIsLive, providerSourceLabel } from "@/lib/analysis/data-mode";
import { buildA4HtmlReport } from "@/lib/analysis/export-a4";
import { buildHwpHtmlReport, copyHtmlToClipboard } from "@/lib/analysis/export-hwp";
import { buildRegionProfile } from "@/lib/layers/region-profile";
import { buildMarkdownReport, type ReportInput } from "@/lib/analysis/export-report";
import { buildSlideHtml } from "@/lib/analysis/export-slide";
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
import { becauseItIs, topicOf } from "@/lib/analysis/korean-particle";
import { suggestMetrics } from "@/lib/layers/suggest-metric";
import { DATA_INVENTORY, INVENTORY_TOTALS } from "@/lib/analysis/data-inventory";
import { GLOSSARY, GLOSSARY_GROUPS } from "@/lib/analysis/glossary";
import { USAGE_GUIDE } from "@/lib/analysis/usage-guide";
import { QUERY_SUGGESTIONS } from "@/lib/analysis/query-rules";
import {
  baseUnit,
  detectMissingMetric,
  detectOutOfScopePlace,
  detectUnsupportedDimension,
  detectUnsupportedFacility,
  detectValueThreshold,
  prefersPublicTool,
  thresholdMatches,
  type ValueThreshold,
} from "@/lib/analysis/query-signals";
import type { AnalysisResult, MetricDescriptor } from "@/lib/analysis/result";
import {
  DEFAULT_COMPARE,
  listDistricts,
  listDongLabels,
  normalizeComparePair,
  type CompareScope,
} from "@/lib/analysis/districts";
import {
  applyFollowUpMerge,
  buildShareSearch,
  isFollowUpQuery,
  parseShareState,
} from "@/lib/analysis/share-state";
import { executeAnalysisIntent } from "@/lib/analysis/tool-registry";
import { FACILITY_TYPE_COLORS } from "@/lib/gis/facility-style";
import { probeRadius } from "@/lib/gis/point-probe";
import { InterpretationCard } from "./interpretation-card";
import type { LiveMapPlace } from "./kakao-map";
import { AdminLevelToggle } from "./admin-level-toggle";
import { AppTopbar } from "./app-topbar";
import { LayerSwitcher, type LayerOption } from "./layer-switcher";
import { MapCanvas } from "./map-canvas";
import { PointProbeCard } from "./point-probe-card";
import { PanelResizer } from "./panel-resizer";
import { QueryHero } from "./query-hero";
import { TrendChart } from "./trend-chart";
import type { AnalysisSnapshot, BoundaryCollection, Facility, RegionSeries } from "./types";
import {
  CUBE_LAYERS,
  NL_LAYERS,
  PRIVATE_LAYERS,
  CROSS_CANDIDATE_LAYERS,
  KCB_GRID_LAYER,
  POPULATION_LAYER,
} from "@/lib/layers/catalog";
import { medicalCubeFromSnapshot, populationCubeFromSnapshot } from "@/lib/layers/from-snapshot";
import { crossLayerView, type CrossLayerResult } from "@/lib/layers/cross-analysis";
import { buildCrossInterpretation } from "@/lib/layers/cross-interpretation";
import { resolveCrossQuery, type CrossQueryMatch } from "@/lib/layers/resolve-cross-query";
import { asksCausation, resolveStatsQuery, type StatsQueryMatch } from "@/lib/layers/resolve-stats-query";
import { correlationView, outlierView, type StatsView } from "@/lib/layers/stats-view";
import { resolveMultiQuery, type MultiQueryMatch } from "@/lib/layers/resolve-multi-query";
import { multiLayerView, type MultiLayerResult } from "@/lib/layers/multi-analysis";
import { resolveTrendQuery, type TrendQueryMatch } from "@/lib/layers/resolve-trend-query";
import { buildTrendRanking } from "@/lib/layers/trend-view";
import { trendCrossView } from "@/lib/layers/trend-cross";
import { resolveTrendCrossQuery, type TrendCrossMatch } from "@/lib/layers/resolve-trend-cross-query";
import { describeTrend } from "@/lib/layers/trend";
import {
  detectPercentLimit,
  detectResultCount,
  resolveLayerQuery,
  type LayerQueryMatch,
} from "@/lib/layers/resolve-layer-query";
import { layerCubeToAnalysisView } from "@/lib/layers/to-analysis-view";
import { LayerCubeSchema, type AdminLevel, type LayerCube, type MetricDef } from "@/lib/layers/types";
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

/*
 * v1 에는 **답하지 못한 질의도 함께** 쌓였다. 그래서 사용자가 오타로 친 말이
 * 「최근 질문」 칩으로 되돌아왔고, 자기 오타를 제품이 쓴 문구로 읽는 일이 있었다.
 * 담는 쪽은 고쳤지만 **이미 담긴 것은 브라우저에 남는다** — 고친 코드를 배포해도
 * 그 사람 화면에는 그대로 보인다. 그래서 자리를 옮기고 옛 자리를 지운다.
 * 옮겨 담지 않는 이유: v1 의 내용 자체가 그 결함으로 만들어진 것이다.
 */
const RECENT_QUERIES_KEY = "ralphton-recent-queries-v2";
const RECENT_QUERIES_LEGACY_KEY = "ralphton-recent-queries-v1";
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
  /*
   * 지도 채색용 0~100. **칠할 것이 없으면 null이다.**
   *
   * 상관·이상치는 지역별 점수가 아니라 지표 사이의 값이라 칠할 것이 없다. 그런데 여기에
   * 0을 박아 두었더니 해석문이 그 0을 그대로 「1위 창원시(0점)」로 인쇄했다(배포본 실측).
   * 존재하지 않는 점수가 화면에 숫자로 나오는 것은, 없는 값을 0으로 메우는 것과 같은
   * 결함이다 — null이면 해석문이 지표 값으로 대신 말한다.
   */
  mapScore: number | null;
  valueLabel: string;
  note: string;
  metrics: MetricDescriptor[];
};

/*
 * 레이어 id는 카탈로그에서 뽑는다. 손으로 적은 합집합은 레이어를 붙일 때마다 어긋나고,
 * 어긋나면 타입이 아니라 화면이 조용히 빈다 — 지표 목록에서 이미 겪은 함정이다.
 */
type LayerId = (typeof CROSS_CANDIDATE_LAYERS)[number]["id"];

type CubeLayerId = Exclude<LayerId, "medical">;
type RemoteCubeLayerId = Exclude<CubeLayerId, "population">;

type AnalysisView = {
  id: QuickId | LayerId | "cross";
  title: string;
  summary: string;
  ranked: RankedRegion[];
  filteredFacilities: Facility[];
  formulaNotes: string[];
  legendLabel: string;
  /** 순위 방향. 결론 문구가 "상위/가장 낮은"을 고를 때 쓴다(값에서 역추론하면 틀린다). */
  rankDirection?: "desc" | "asc";
  /**
   * 여러 지표를 z로 합쳐 줄 세운 결과인가. 그러면 순위를 대표하는 단일 지표가 없어
   * 값 조건을 걸 자리가 없다. `id === "cross"`로는 못 가린다 — 단일 지표 추세도 그 id를
   * 쓰기 때문에, 그걸로 판단했더니 "카드매출 늘어나는 동"까지 합성이라고 말했다.
   */
  compositeRanking?: boolean;
  /**
   * 이 결과의 행이 무엇인가("시군구"). 공공 도구 결과는 activeLayerId가 "medical"인 채로
   * 렌더돼, 화면 아래 "N개 …" 표기가 시군구 결과에도 "행정동"이라 적혔다(prod 실측).
   * 결과가 스스로 말하게 한다.
   */
  unitWord?: string;
  isFacilityResult: boolean;
  /** 교차분석처럼 공공 스냅샷과 기준월·출처가 다른 결과의 표기용 메타(내보내기에 사용). */
  provenance?: { referenceMonth: string; source: string };
  /**
   * 실제 분석 대상 건수. ranked가 표시 상한으로 잘린 경우(교차분석) 이 값이 진짜 모수다.
   * 보고서가 ranked.length를 모수로 쓰면 잘못된 대상 수가 실린다.
   */
  totalCount?: number;
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

/*
 * 손으로 적던 목록이었다. KOSIS 여덟 레이어를 카탈로그에 붙이고 이 배열은 안 고쳐서,
 * 「활용 데이터」는 22개라 적고 「직접 고르기」에는 14개만 나왔다 — 남은 여덟은 질문으로만
 * 닿을 수 있었고, 그런 게 있는 줄도 알 수 없었다. 바로 아래 주석이 경고하던 그 어긋남이다.
 * 그래서 정본에서 만든다.
 */
const LAYER_OPTIONS: LayerOption[] = CROSS_CANDIDATE_LAYERS.map((layer) => ({
  id: layer.id,
  label: layer.label,
  provider: layer.provider,
}));

/**
 * 레이어별 지표 목록. 손으로 적으면 반드시 어긋난다 — 실제로 의료를 교차 후보에 더하고도
 * 여기 빠뜨려, 교차가 조용히 false를 돌리고 화면은 기존 분석을 그대로 두었다.
 * 카탈로그에서 파생시켜 그럴 수 없게 한다.
 */
const CUBE_LAYER_METRICS: Record<string, MetricDef[]> = Object.fromEntries(
  CROSS_CANDIDATE_LAYERS.map((layer) => [layer.id, [...layer.metrics]]),
);

const LAYER_PROVIDERS: Record<string, string> = Object.fromEntries(
  CROSS_CANDIDATE_LAYERS.map((layer) => [layer.id, layer.provider]),
);

/**
 * Remote choropleth cubes fetched from static JSON. Adding a row here (plus a catalog
 * LayerDescriptor + CUBE_LAYER_METRICS entry) is all a new private layer needs — the
 * fetch, active-cube lookup, and loading state are all driven off this list.
 */
const REMOTE_CUBE_LAYERS: Array<{ id: RemoteCubeLayerId; url: string; label: string }> =
  CUBE_LAYERS.filter((layer) => layer.id !== "population").map((layer) => ({
    id: layer.id as RemoteCubeLayerId,
    url: `/data/layers/${layer.id}.json`,
    label: layer.label,
  }));

/**
 * Private-provider layers (SKT/NH/KCB) that natural language may switch to directly.
 * Public population/medical stay on the tool-registry path, so only private layers go
 * here — this is what lets "생활인구 많은 동"/"카드매출 높은 곳"/"평균소득 높은 동" reach the
 * private layers instead of being swallowed by the public 인구 ranking.
 */
const PRIVATE_NL_LAYERS = NL_LAYERS;

/**
 * One-click 교차분석 presets. Each `query` goes through the same resolver the NL path
 * uses, so a preset can never drift from what typing that sentence would do.
 */
/**
 * 프리셋이 10개로 늘어 한 덩어리로 두면 무엇을 눌러야 할지 고르기 어렵다. 정책 영역으로
 * 묶어 목적부터 좁힌 뒤 고르게 한다.
 */
const CROSS_PRESET_GROUPS = ["상권 활력", "생활·정주", "취약·격차"] as const;
type CrossPresetGroup = (typeof CROSS_PRESET_GROUPS)[number];

const CROSS_PRESETS: Array<{
  id: string;
  label: string;
  subtitle: string;
  query: string;
  group: CrossPresetGroup;
}> = [
  {
    id: "living-vs-sales",
    group: "상권 활력",
    label: "유동 대비 저매출",
    subtitle: "생활인구↑ 카드매출↓",
    query: "생활인구 대비 카드매출 낮은 동",
  },
  {
    id: "income-vs-spend",
    group: "상권 활력",
    label: "소득 대비 저소비",
    subtitle: "소득↑ 카드소비↓",
    query: "평균소득 대비 카드매출 낮은 동",
  },
  {
    id: "inflow-vs-sales",
    group: "상권 활력",
    label: "유입 대비 저매출",
    subtitle: "유입인구↑ 매출↓",
    query: "유입인구 대비 카드매출 낮은 동",
  },
  {
    id: "income-and-credit",
    group: "생활·정주",
    label: "소득·신용 동반",
    subtitle: "둘 다 높은 지역",
    query: "평균소득과 신용평점 모두 높은 동",
  },
  {
    id: "movein-vs-sales",
    group: "생활·정주",
    label: "전입 대비 저매출",
    subtitle: "전입인구↑ 매출↓",
    query: "전입 대비 카드매출 낮은 동",
  },
  {
    id: "daytime-vs-sales",
    group: "상권 활력",
    label: "주간인구 대비 저매출",
    subtitle: "주간인구↑ 매출↓",
    query: "주간인구 대비 카드매출 낮은 동",
  },
  {
    id: "nightpop-vs-nightsales",
    group: "상권 활력",
    label: "야간인구 대비 저매출",
    subtitle: "밤에 사람은 있는데 소비는↓",
    query: "야간인구 대비 야간 매출 낮은 동",
  },
  {
    id: "nightpop-vs-pub",
    group: "상권 활력",
    label: "야간인구 대비 주점 부족",
    subtitle: "야간 상권 육성 후보",
    query: "야간인구 대비 주점 비중 낮은 동",
  },
  {
    id: "senior-vs-medical",
    group: "취약·격차",
    label: "고령 소비 대비 의료 부족",
    subtitle: "고령 소비↑ 병의원↓",
    query: "고령 소비비중 대비 병의원 비중 낮은 동",
  },
  {
    id: "cafe-and-youth",
    group: "상권 활력",
    label: "청년 상권",
    subtitle: "카페·청년 소비 동반↑",
    query: "카페 비중과 청년 소비비중 모두 높은 동",
  },
];

/**
 * 원클릭 추세 프리셋. 자연어를 모르면 추세 기능에 닿을 길이 없어 함께 노출한다.
 * 프리셋도 자연어와 같은 리졸버를 거치므로 문장을 직접 친 것과 결과가 갈리지 않는다.
 */
const TREND_PRESETS: Array<{ id: string; label: string; subtitle: string; query: string }> = [
  {
    id: "sales-rising",
    label: "카드매출 증가",
    subtitle: "상권이 커지는 동",
    query: "카드매출 늘어나는 동",
  },
  {
    id: "living-falling",
    label: "생활인구 감소",
    subtitle: "사람이 빠지는 동",
    query: "생활인구 줄어드는 동",
  },
  {
    id: "income-rising",
    label: "평균소득 증가",
    subtitle: "소득이 오르는 동",
    query: "평균소득 증가하는 동",
  },
  {
    id: "delinquency-rising",
    label: "연체율 상승",
    subtitle: "가계 부담 신호",
    query: "연체율 증가하는 동",
  },
];

/** 교차분석 후보 = 큐브 레이어 + 의료취약지수(catalog 단일 출처). */
const CROSS_LAYERS = CROSS_CANDIDATE_LAYERS;

/**
 * 결과 단위를 부르는 말. 격자 레이어는 행정동이 아니라 칸이라 "행정동 1,267개"로 쓰면
 * 사실과 다르다(prod 실측).
 */
function unitWordOf(layerId: string, adminLevel: AdminLevel): string {
  if (layerId.startsWith("kcb-grid")) return "격자";
  return adminLevel === "sgg" ? "시군구" : "행정동";
}

function formatCrossValue(value: number | null, unit: string): string {
  if (value === null) return "데이터 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
}

/** Build a copilot AnalysisView from a cross-analysis result (rendered like a tool result). */
function crossResultToView(
  cross: CrossLayerResult,
  a: { provider: string; metric: MetricDef; referenceMonth: string },
  b: { provider: string; metric: MetricDef; referenceMonth: string },
  mode: "gap" | "both",
  limit = 30,
): AnalysisView {
  const modeLabel =
    mode === "gap"
      ? `${a.metric.label} 대비 ${b.metric.label} 낮은`
      : `${a.metric.label}·${b.metric.label} 동시 높은`;
  const sign = mode === "gap" ? "−" : "+";

  const ranked: RankedRegion[] = cross.ranked.slice(0, limit).map((row) => {
    const name = row.name.replace(/^경상남도\s*/, "");
    return {
      code: row.code,
      name,
      district: name.split(/\s+/)[0] ?? "지역",
      mapScore: cross.scores.get(row.code) ?? 0,
      valueLabel: `${a.metric.label} ${formatCrossValue(row.valueA, a.metric.unit)} · ${b.metric.label} ${formatCrossValue(row.valueB, b.metric.unit)}`,
      note: `합성 ${row.composite.toFixed(2)} · z${a.metric.label} ${row.zA.toFixed(1)} / z${b.metric.label} ${row.zB.toFixed(1)}`,
      metrics: [
        {
          label: `${a.metric.label} (${a.provider})`,
          value: row.valueA,
          unit: a.metric.unit,
          formula: a.metric.formula,
          referenceMonth: a.referenceMonth,
          limitation: a.metric.limitation,
        },
        {
          label: `${b.metric.label} (${b.provider})`,
          value: row.valueB,
          unit: b.metric.unit,
          formula: b.metric.formula,
          referenceMonth: b.referenceMonth,
          limitation: b.metric.limitation,
        },
      ],
    };
  });

  // 순위 나열이 아니라 두 지표가 어떻게 엇갈리는지를 설명하는 교차 전용 해석문.
  const interpretation = buildCrossInterpretation(
    cross.ranked,
    { label: a.metric.label, unit: a.metric.unit, provider: a.provider },
    { label: b.metric.label, unit: b.metric.unit, provider: b.provider },
    mode,
  );

  return {
    id: "cross",
    title: `교차분석 · ${modeLabel} 지역`,
    compositeRanking: true,
    summary: interpretation,
    ranked,
    filteredFacilities: [],
    formulaNotes: [
      `합성점수 = z(${a.metric.label}) ${sign} z(${b.metric.label})`,
      `${a.metric.label}: ${a.metric.formula} (${a.provider})`,
      `${b.metric.label}: ${b.metric.formula} (${b.provider})`,
      "z-표준화는 경남 행정동 전체 분포 기준이며 두 지표 모두 값이 있는 동만 비교합니다.",
    ],
    legendLabel: `${modeLabel} 분포`,
    isFacilityResult: false,
    totalCount: cross.ranked.length,
    provenance: {
      // 두 지표의 기준월이 다를 수 있으므로 양쪽을 모두 남긴다.
      referenceMonth:
        a.referenceMonth === b.referenceMonth
          ? a.referenceMonth
          : `${a.referenceMonth} / ${b.referenceMonth}`,
      source: `${a.provider} ${a.metric.label} × ${b.provider} ${b.metric.label}`,
    },
  };
}

/**
 * 세 지표 이상 겹쳐 본 결과를 화면 모델로 옮긴다.
 *
 * 2지표(crossResultToView)와 다른 점은 지표 수가 정해져 있지 않다는 것과, gap(대비) 개념이
 * 없다는 것이다. 대신 지표마다 물어본 방향을 문장에 그대로 적어 준다 — "생활인구 많고
 * 소득 높고 연체 낮은"을 화면이 다시 말해 줘야 사용자가 자기 질문이 제대로 읽혔는지 안다.
 */
function multiResultToView(
  result: MultiLayerResult,
  operands: Array<{
    provider: string;
    metric: MetricDef;
    referenceMonth: string;
    direction: "high" | "low";
  }>,
  adminLevel: AdminLevel,
  limit = 30,
): AnalysisView {
  const wordOf = (direction: "high" | "low") => (direction === "high" ? "높은" : "낮은");
  const condition = operands
    .map((operand) => `${operand.metric.label} ${wordOf(operand.direction)}`)
    .join(" · ");

  const ranked: RankedRegion[] = result.ranked.slice(0, limit).map((row) => {
    const name = row.name.replace(/^경상남도\s*/, "");
    return {
      code: row.code,
      name,
      district: name.split(/\s+/)[0] ?? "지역",
      mapScore: result.scores.get(row.code) ?? 0,
      valueLabel: `합성 ${row.composite.toFixed(2)}`,
      note: operands
        .map((operand, index) => `${operand.metric.label} ${formatCrossValue(row.values[index] ?? null, operand.metric.unit)}`)
        .join(" · "),
      metrics: operands.map((operand, index) => ({
        label: `${operand.metric.label} (${operand.provider})`,
        value: row.values[index] ?? null,
        unit: operand.metric.unit,
        formula: operand.metric.formula,
        referenceMonth: operand.referenceMonth,
        limitation: operand.metric.limitation,
      })),
    };
  });

  const unit = adminLevel === "sgg" ? "시군구" : "행정동";
  /*
   * 몇 곳을 견줬는지 밝힌다. 지표가 늘수록 전부 값이 있는 지역은 줄어드는데, 그 사실을
   * 말하지 않으면 "경남 전체를 본 결과"로 읽힌다.
   */
  const dropped = result.total - result.comparable;
  const summary =
    result.comparable === 0
      ? `${condition} 조건을 모두 볼 수 있는 ${unit}이 없습니다. 지표 하나라도 값이 없는 곳은 비교에서 빠집니다.`
      : `${condition} 순으로 ${result.comparable.toLocaleString("ko-KR")}개 ${unit}을 비교했습니다.` +
        (dropped > 0
          ? ` ${dropped.toLocaleString("ko-KR")}개는 지표 중 일부가 없어 제외했습니다.`
          : "");

  return {
    id: "cross",
    title: `다중조건 · ${condition}`,
    compositeRanking: true,
    summary,
    ranked,
    filteredFacilities: [],
    formulaNotes: [
      `합성점수 = ${operands.map((operand) => `${operand.direction === "high" ? "+" : "−"}z(${operand.metric.label})`).join(" ")}`,
      ...operands.map((operand) => `${operand.metric.label}: ${operand.metric.formula} (${operand.provider})`),
      `z-표준화는 경남 ${unit} 전체 분포 기준이며, 모든 지표에 값이 있는 곳만 비교합니다.`,
    ],
    legendLabel: `${condition} 분포`,
    isFacilityResult: false,
    totalCount: result.ranked.length,
    provenance: {
      referenceMonth: [...new Set(operands.map((operand) => operand.referenceMonth))].join(" / "),
      source: operands.map((operand) => `${operand.provider} ${operand.metric.label}`).join(" × "),
    },
  };
}

const QUICK_ANALYSES: Array<{
  id: QuickId;
  label: string;
  subtitle: string;
  symbol: string;
  tone: string;
}> = [
  /*
   * 이름은 **무엇을 재는지** 말해야 한다. 「의료 취약」은 그 자체로는 뜻이 서지 않아
   * 「어디가 부족한가」라는 부제를 붙여도 무엇을 어떻게 잰 값인지 알 수 없었다 —
   * 실제로 「의료취약지역이 뭐냐」는 물음을 받았다. 산식이 부제에 들어가야 한다.
   *
   * 이 여덟 개는 공공 스냅샷(인구·의료기관)으로 도는 것들이다. 민간 특화 데이터
   * (SKT·NH·KCB)는 질의창과 레이어에서 다루므로, 여기서 의료가 다수라고 해서 이 도구가
   * 의료 도구인 것은 아니다. 이름이 그 오해를 만들지 않게 적는다.
   */
  { id: "scarcity", label: "의료 접근성", subtitle: "공급·거리·고령수요 합성", symbol: "+", tone: "bg-rose-50 text-rose-600" },
  { id: "elderly", label: "고령 대비 의료", subtitle: "고령비율 높은 순", symbol: "◎", tone: "bg-violet-50 text-violet-600" },
  { id: "growth", label: "인구 증가", subtitle: "최근 1년 변화율", symbol: "↗", tone: "bg-emerald-50 text-emerald-600" },
  { id: "nearest", label: "최근접 의료기관", subtitle: "대표점 직선거리", symbol: "⌖", tone: "bg-sky-50 text-sky-600" },
  { id: "radius", label: "반경 내 의료기관", subtitle: "1~3km 안 기관 수", symbol: "◉", tone: "bg-blue-50 text-blue-600" },
  { id: "compare", label: "지역 비교", subtitle: "두 곳 나란히", symbol: "⇄", tone: "bg-amber-50 text-amber-700" },
  { id: "facilities", label: "의료기관 목록", subtitle: "병원·의원·약국", symbol: "◆", tone: "bg-cyan-50 text-cyan-700" },
  { id: "reset", label: "초기화", subtitle: "처음부터", symbol: "↺", tone: "bg-slate-100 text-slate-600" },
];

function compactName(region: RegionSeries): string {
  return region.adm_nm.replace(/^경상남도\s*/, "");
}

function quickIntent(
  id: QuickId,
  radiusKm: 1 | 2 | 3,
  regionLimit: number,
  comparePair: [string, string] = DEFAULT_COMPARE,
): AnalysisIntent {
  const limit = Math.max(1, Math.min(regionLimit, 600));
  const intents: Record<QuickId, AnalysisIntent> = {
    scarcity: { tool: "rankHospitalScarcity", filters: { limit } },
    elderly: { tool: "rankElderlyUnderserved", filters: { limit } },
    growth: { tool: "rankPopulationGrowthPressure", filters: { limit } },
    nearest: { tool: "nearestFacilityDistance", filters: { limit } },
    radius: { tool: "countFacilitiesWithinRadius", filters: { radiusKm, limit } },
    compare: { tool: "compareRegions", filters: { compare: [...comparePair] } },
    facilities: {
      tool: "filterFacilitiesByTypeAndHours",
      filters: {},
    },
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
  /*
   * 시군구로 합쳐진 행은 이름이 "경상남도 김해시"(2토큰)이고 행정동은 3토큰이다.
   * 데이터 자체로 판별하면 호출부마다 단위를 들고 다니지 않아도 된다.
   */
  const isDistrictLevel =
    source.length > 0 && source.every((region) => region.adm_nm.trim().split(/\s+/).length <= 2);
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
      name: region.adm_nm.replace(/^경상남도\s*/, ""),
      district: region.adm_nm.split(" ")[1] ?? "지역",
      mapScore,
      valueLabel: primaryMetric
        ? formatMetric(primaryMetric.value, primaryMetric.unit)
        : region.score === null
          ? "데이터 없음"
          : formatMetric(region.score, "점"),
      /*
       * 도구가 동반 지표를 붙였으면 전부 담는다 — 고령화 속도+현재 수준, 세대 수+세대당 인구,
       * 사망 수+1만 명당. 이 `note` 한 칸이 목록·CSV·HWP·리포트·슬라이드가 공통으로 읽는
       * 자리라, 첫 지표만 담으면 산식 각주는 "함께 보세요"라 말하는데 함께 볼 곳이 없다.
       * 지금까지 두 번째 지표는 클릭해야 나오는 상세 카드에만 있었다(prod 실측).
       */
      note:
        region.metrics.length > 1
          ? region.metrics
              .map((metric) => `${metric.label} ${formatMetric(metric.value, metric.unit)}`)
              .join(" · ")
          : primaryMetric
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
    unitWord: isDistrictLevel ? "시군구" : undefined,
  };
}

function executeQuickAnalysis(
  snapshot: AnalysisSnapshot,
  id: QuickId,
  radiusKm: 1 | 2 | 3,
  comparePair: [string, string] = DEFAULT_COMPARE,
): AnalysisView {
  const result = executeAnalysisIntent(
    quickIntent(id, radiusKm, snapshot.regions.length, comparePair),
    snapshot,
  );
  const titleOverride =
    id === "facilities"
      ? "의료기관"
      : id === "compare"
        ? `${comparePair[0]} vs ${comparePair[1]}`
        : undefined;
  return resultToView(id, result, titleOverride);
}

const MAP_FACILITY_CAP = 900;
const RESULT_PAGE_STEP = 24;

function dataSourceLabel(source: string): string {
  if (source === "demo") return "출처: 로컬 데모";
  if (source === "demo-fallback") return "출처: 데모(폴백)";
  if (source === "supabase-cache") return "출처: 서버 캐시";
  if (source === "loading") return "출처: 로딩 중";
  return `출처: ${source}`;
}

function mapEngineLabel(kakaoMapKey: string, mapEngine: "kakao" | "demo" | "unknown"): string {
  if (!kakaoMapKey) return "임시 지도";
  if (mapEngine === "demo") return "임시 지도(연결 실패)";
  if (mapEngine === "kakao") return "카카오 지도";
  return "카카오 지도 연결 중";
}

type AiLastOutcome =
  | { state: "unknown" }
  | { state: "ok"; at: string }
  | { state: "failed"; at: string; code: string };

/**
 * 왜 안 되는지를 사람이 읽는 말로. "미설정"만 띄우면 설정은 다 돼 있는데 접속 주소가
 * 허용 목록 밖이라 매번 실패하던 상태를 구분할 수 없다(운영에서 실제로 그랬다).
 */
function aiIssueLabel(code: string | null | undefined): string | null {
  switch (code) {
    case "credential_missing":
      return "이용 자격이 등록되지 않았습니다.";
    case "endpoint_invalid":
    case "endpoint_not_allowed":
      return "허용되지 않은 접속 주소가 설정돼 있습니다.";
    case "upstream_rejected":
      return "제공처가 요청을 거절했습니다 (자격·잔액 확인 필요).";
    case "upstream_timeout":
      return "응답이 시간 안에 오지 않았습니다.";
    case "upstream_unreachable":
      return "제공처에 접속하지 못했습니다.";
    case "upstream_status":
      return "제공처가 오류를 돌려주었습니다.";
    case "response_not_json":
      return "받은 응답을 이해하지 못했습니다.";
    default:
      return null;
  }
}

function aiOutcomeLabel(outcome: AiLastOutcome | null): string {
  if (!outcome || outcome.state === "unknown") {
    return "마지막 해석 시도: 기록 없음 (규칙만으로 답한 질의는 시도하지 않습니다)";
  }
  const at = new Date(outcome.at).toLocaleString("ko-KR");
  if (outcome.state === "ok") return `마지막 해석 시도: 성공 · ${at}`;
  return `마지막 해석 시도: 실패 · ${aiIssueLabel(outcome.code) ?? "사유 미상"} · ${at}`;
}

type CapabilityFlags = {
  kakaoMapsJs: boolean;
  kakaoRest: boolean;
  ai: boolean;
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
  /*
   * 지도가 선택 지역을 따라 확대할지. 사용자가 지도나 순위에서 직접 고른 선택만 따라간다.
   *
   * 분석 결과의 1위는 자동 선택되는데, 그것까지 따라가면 앱을 여는 순간 지도가 산속 읍면
   * 하나로 확대돼 화면이 단색으로 덮였다(prod 실측). 새 분석을 돌릴 때마다 다시 꺼서
   * "경남 전체 분포"로 돌아온다.
   */
  const [followSelection, setFollowSelection] = useState(false);
  const [radiusKm, setRadiusKm] = useState<1 | 2 | 3>(2);
  /*
   * 지점 분석. 지금까지 반경은 행정동 대표지점에만 걸렸는데, 현장에서 묻는 말은
   * "이 동 중심에서"가 아니라 "여기서"다 — 후보 부지, 사고 지점, 민원이 들어온 골목.
   * 분석 반경(radiusKm)과 따로 둔다. 하나를 돌리면 다른 하나가 조용히 바뀐다.
   */
  const [probeMode, setProbeMode] = useState(false);
  const [probePoint, setProbePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [probeRadiusKm, setProbeRadiusKm] = useState(2);
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
  const [aiIssue, setAiIssue] = useState<string | null>(null);
  const [aiLastOutcome, setAiLastOutcome] = useState<AiLastOutcome | null>(null);
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
  const [resultSearch, setResultSearch] = useState("");
  const [resultLimit, setResultLimit] = useState(RESULT_PAGE_STEP);
  /* "상위 10%"는 전체 행 수를 알아야 개수가 나온다. 분석이 끝난 뒤 렌더에서 환산한다. */
  const [percentLimit, setPercentLimit] = useState<number | null>(null);
  /* "5곳만"처럼 **사용자가 적은** 개수. 화면 페이징 기본값과 구분해야 내보내기가 맞는다. */
  const [explicitCount, setExplicitCount] = useState<number | null>(null);
  /* "100만원 이상" 같은 값 조건. 지표 단위가 맞을 때만 실제로 거른다. */
  const [valueThreshold, setValueThreshold] = useState<ValueThreshold | null>(null);
  /** Facility list sort when showing facilities */
  const [facilitySort, setFacilitySort] = useState<"name" | "type">("name");
  const [reloadToken, setReloadToken] = useState(0);
  const densityHydratedRef = useRef(false);
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
    applyPreset,
  } = usePanelLayout();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [toast, setToast] = useState<string | null>(null);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>("balanced");
  const [drillTrail, setDrillTrail] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<LayerId>("medical");
  /* 세션 안에서만. 첫 방문자가 접힌 고르기를 보면 지표 자리가 안 보인다. */
  const [pickerOpen, setPickerOpen] = useState(true);
  // 낮은 쪽을 물었으면 순위를 뒤집는다. 레이어를 바꿔도 방향이 남아 있으면 혼란스러우므로
  // 새 질의·레이어 선택 때마다 다시 정한다.
  const [layerDirection, setLayerDirection] = useState<"desc" | "asc">("desc");
  // 질의에 시군구가 적혀 있으면 그 안에서만 줄을 세운다.
  const [layerRegionFilters, setLayerRegionFilters] = useState<string[]>([]);
  /**
   * 방금 질의에 답하지 못했는가.
   *
   * 답을 못 찾아도 화면에는 직전 분석이 그대로 남는다(작업을 잃지 않게 하려는 것이다).
   * 그런데 그러면 "오늘 날씨 어때"에 "평균소득 상위 3곳은 …"이 붙어 그 질문의 답처럼
   * 읽힌다(prod 실측). 결과를 지우는 대신 직전 것임을 밝힌다.
   */
  const [answeredLastQuery, setAnsweredLastQuery] = useState(true);
  // 부트 이펙트가 runQueryText 정의보다 위에 있어 ref로 잡아 둔다.
  const runQueryTextRef = useRef<((raw: string) => Promise<void>) | null>(null);
  /*
   * 공유 링크의 질문은 스냅샷이 **상태에 반영된 뒤** 실행해야 한다.
   *
   * 복원은 스냅샷 fetch의 .then 안에서 일어나는데, 그 시점의 runQueryText 클로저는 아직
   * snapshot이 null이라 `if (!snapshot) return;`에 걸려 조용히 아무것도 안 한다. 민간 큐브
   * 질의는 그 줄 앞에서 반환해 우연히 살아 있었고, 공공 도구 질의만 죽어 있었다.
   */
  const [pendingShareQuery, setPendingShareQuery] = useState<string | null>(null);
  const shareQueryRunRef = useRef(false);

  const [activeMetricKey, setActiveMetricKey] = useState<string>(POPULATION_LAYER.metrics[0].key);
  const [adminLevel, setAdminLevel] = useState<AdminLevel>("dong");
  /**
   * 지금 단위를 누가 정했나.
   *
   * 질의가 정한 단위를 다음 질의까지 물려주면, "전입보다 전출이 많은 곳"(전출이 시군구
   * 지표라 시군구가 된다) 다음에 "소득 대비 소비가 과한 지역"을 물었을 때도 시군구로
   * 답한다(prod 실측). 사용자가 토글로 고른 것만 이어받고, 질의가 바꾼 것은 그 질의에만
   * 적용한다 — 적지 않았으면 행정동이 기본이다.
   */
  const adminLevelSourceRef = useRef<"user" | "query">("user");
  const [remoteCubes, setRemoteCubes] = useState<Record<string, LayerCube | null>>({});
  // 추세를 볼 기간. 0은 전 기간. 장기 추세와 최근 흐름이 갈리는 동이 14%라 바꿔 볼 수 있어야 한다.
  const [trendMonths, setTrendMonths] = useState<number>(0);
  const [remoteCubeErrors, setRemoteCubeErrors] = useState<Record<string, string | null>>({});
  /*
   * 바텀시트 기본 높이. 72dvh이면 답을 받는 순간 지도가 거의 다 덮인다 — 지도가 이
   * 도구의 산출물인데 순위만 남는다. 절반(56)이면 한 줄 결론과 1~2위가 보이면서 지도도
   * 남는다. 더 보고 싶으면 손잡이를 끌거나 "높게"를 누르면 된다.
   */
  const [sheetHeight, setSheetHeight] = useState(56);
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

  /*
   * Hydrate theme preference once; bootstrap script already painted resolved theme.
   *
   * localStorage는 서버에 없다. 렌더 중(또는 useState 초기값)에 읽으면 서버가 그린 것과
   * 달라져 하이드레이션이 깨진다. 마운트 뒤 한 번 맞추는 것이 유일한 방법이라, 이 규칙이
   * 말하는 "연쇄 렌더"는 여기서 피할 수 없는 비용이다(마운트당 1회).
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // 최근 질문·첫 방문 여부도 localStorage라 마운트 뒤에만 알 수 있다(위 테마와 같은 이유).
  useEffect(() => {
    try {
      window.localStorage.removeItem(RECENT_QUERIES_LEGACY_KEY);
      const raw = window.localStorage.getItem(RECENT_QUERIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
            ? executeQuickAnalysis(snapshot, activeQuick, radiusKm, comparePair).ranked
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
      fetch(`/data/administrative-dong-${boundaryVersion}.geojson`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("행정동 경계를 불러오지 못했습니다.");
        return response.json() as Promise<BoundaryCollection>;
      }),
    ])
      .then(([nextSnapshot, nextBoundary]) => {
        setSnapshot(nextSnapshot);
        setBoundary(nextBoundary);

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
          /*
           * 질문이 실려 있으면 **그 질문을 다시 실행해** 복원한다. 도구 이름만 재생하지 않는다.
           *
           * 처음에는 민간·교차·추세 결과에만 이 경로를 썼다. 공공 도구는 `tool`을 재생하면
           * 된다고 봤는데, 그러면 질문에만 있던 조건이 조용히 사라진다 — 시군구 단위(adminLevel),
           * "상위 10%"(percentLimit), "400만원 이상"(valueThreshold)은 전부 질문을 파싱해야
           * 나오는 값이라 `tool` 하나에 담기지 않는다. "총인구 많은 시군구 상위 10%"를 공유하면
           * 305개 행정동 전체 순위로 열렸다(prod 실측). 조건이 빠진 채 답이 나오는 것이 최악이다.
           *
           * 조건을 URL 필드로 하나씩 늘리는 대신 질문을 다시 태운다 — 앞으로 새 조건이 생겨도
           * 링크 형식을 건드릴 일이 없다. `tool` 경로는 질문 없이 빠른 버튼만 눌러 공유한
           * 경우에 그대로 남는다.
           */
          if (share.q) {
            setPendingShareQuery(share.q);
            return;
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
              // 공공 도구 결과는 customAnalysis로 렌더된다. 민간 큐브 레이어가 활성인 채로
              // 두면 그 레이어 분석이 우선해 결과가 화면에 나타나지 않는다.
              setActiveLayerId("medical");
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

        const initial = executeQuickAnalysis(nextSnapshot, "scarcity", 2, DEFAULT_COMPARE);
        setSelectedRegionCode((current) => current ?? initial.ranked[0]?.code ?? nextSnapshot.regions[0]?.adm_cd2 ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "데이터 로드 중 오류가 발생했습니다.");
      });
    return () => controller.abort();
  }, [boundaryVersion, snapshotMode, reloadToken]);

  /**
   * 운영 상태(기능 플래그·게시 시각·동기화 권고)를 화면과 별도로 받는다.
   *
   * 이 둘은 상단 배지와 토스트에만 쓰이는데 전에는 스냅샷·경계와 한 Promise.all에 묶여 있었다.
   * 두 API는 서버리스 콜드스타트로 2~3초가 걸려, 정작 지도에 필요한 데이터가 1초에 도착하고도
   * 화면은 3초 넘게 "준비하는 중"에 머물렀다. 순서(health 먼저, sync가 덮어씀)는 그대로 둔다.
   */
  useEffect(() => {
    const controller = new AbortController();
    const json = (path: string) =>
      fetch(path, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);

    Promise.all([json("/api/health"), json("/api/data/sync")]).then(([health, syncStatus]) => {
      if (controller.signal.aborted) return;
      if (health && typeof health === "object" && "capabilities" in health) {
        setCapabilities((health as { capabilities: CapabilityFlags }).capabilities);
        setAiIssue((health as { aiIssue?: string | null }).aiIssue ?? null);
        setAiLastOutcome((health as { aiLastOutcome?: AiLastOutcome }).aiLastOutcome ?? null);
        if ("publishedLive" in health) {
          setPublishedLive((health as { publishedLive: PublishedLiveInfo }).publishedLive ?? null);
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
          /*
           * 게시 주기 경과는 운영자에게 할 말이지 분석하러 온 사람에게 할 말이 아니다.
           * "마지막 게시 후 213시간 경과 (권장 24시간)"이 첫 화면에 검은 토스트로 떠
           * 있었다(prod 실측). 데이터 탭의 운영 현황(syncOps)에 그대로 남으므로 여기서는
           * 띄우지 않는다.
           */
        }
      }
    });

    return () => controller.abort();
  }, [reloadToken]);

  /**
   * 민간 큐브를 필요할 때 받는다.
   *
   * 마운트 즉시 11개를 모두 받으면 1.4MB를 첫 화면에서 내려받게 되는데, 시작 화면은 의료
   * 레이어라 그중 어느 것도 당장 쓰이지 않는다. 모바일에서 초기 로딩이 길어지던 원인이다.
   * 지금 보고 있는 레이어를 먼저 받고, 화면이 뜬 뒤 나머지를 배경에서 채워 교차·추세 질의가
   * 곧바로 동작하게 한다.
   */
  const requestedCubesRef = useRef(new Set<string>());
  const loadCube = useCallback((layer: (typeof REMOTE_CUBE_LAYERS)[number], signal?: AbortSignal) => {
    if (requestedCubesRef.current.has(layer.id)) return;
    requestedCubesRef.current.add(layer.id);
    fetch(layer.url, { signal })
      .then((response) => {
        if (!response.ok) throw new Error(`${layer.label} 레이어를 불러오지 못했습니다.`);
        return response.json();
      })
      .then((raw: unknown) => {
        const parsed = LayerCubeSchema.safeParse(raw);
        if (!parsed.success) {
          setRemoteCubeErrors((prev) => ({ ...prev, [layer.id]: `${layer.label} 레이어 데이터 형식이 올바르지 않습니다.` }));
          return;
        }
        setRemoteCubes((prev) => ({ ...prev, [layer.id]: parsed.data }));
        setRemoteCubeErrors((prev) => ({ ...prev, [layer.id]: null }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 실패한 큐브는 다시 시도할 수 있어야 한다.
        requestedCubesRef.current.delete(layer.id);
        setRemoteCubeErrors((prev) => ({
          ...prev,
          [layer.id]: error instanceof Error ? error.message : `${layer.label} 레이어를 불러오지 못했습니다.`,
        }));
      });
  }, []);

  // 지금 보고 있는 레이어가 민간 큐브라면 즉시 받는다.
  useEffect(() => {
    const target = REMOTE_CUBE_LAYERS.find((layer) => layer.id === activeLayerId);
    if (target) loadCube(target);
  }, [activeLayerId, loadCube]);

  /**
   * 아직 없는 큐브를 당겨오고, 도착하면 그 질의를 다시 실행한다.
   *
   * 큐브를 화면이 뜬 뒤에 받도록 미루면서, 화면이 뜨자마자 민간 질의를 던진 사용자가
   * "잠시 후 다시 시도해 주세요"를 보는 창이 생겼다. 사용자에게 다시 하라고 할 일이
   * 아니라 필요한 것을 받아서 이어가면 된다.
   */
  const [pendingCubeQuery, setPendingCubeQuery] = useState<
    | { kind: "trend"; match: TrendQueryMatch }
    | { kind: "cross"; match: CrossQueryMatch }
    | { kind: "multi"; match: MultiQueryMatch }
    | { kind: "trendCross"; match: TrendCrossMatch }
    /* 상관 답에는 "원인을 물었는가"가 실려야 해서 원문을 함께 들고 간다. */
    | { kind: "stats"; match: StatsQueryMatch; query: string }
    | null
  >(null);

  const requestCubesAndRetry = useCallback(
    (layerIds: string[], pending: NonNullable<typeof pendingCubeQuery>) => {
      const targets = layerIds
        .map((id) => REMOTE_CUBE_LAYERS.find((layer) => layer.id === id))
        .filter((layer): layer is (typeof REMOTE_CUBE_LAYERS)[number] => Boolean(layer));
      if (targets.length === 0) return;
      setPendingCubeQuery(pending);
      for (const layer of targets) loadCube(layer);
    },
    [loadCube],
  );


  // 나머지는 첫 화면에 필요한 스냅샷·경계가 도착한 뒤 받는다. 큐브 11개(약 1.4MB)가 대역을
  // 먼저 차지하면 정작 화면을 띄우는 데 필요한 데이터가 밀려 "준비하는 중"이 길어진다.
  // 필수 데이터가 온 뒤 곧바로 시작하므로 교차·추세 질의는 큐브를 기다리지 않는다.
  useEffect(() => {
    if (!snapshot || !boundary) return;
    const controller = new AbortController();
    for (const layer of REMOTE_CUBE_LAYERS) loadCube(layer, controller.signal);
    return () => controller.abort();
  }, [snapshot, boundary, loadCube]);

  const districtOptions = useMemo(
    () => (snapshot ? listDistricts(snapshot.regions) : [...DEFAULT_COMPARE]),
    [snapshot],
  );

  const dongOptions = useMemo(
    () => (snapshot ? listDongLabels(snapshot.regions) : []),
    [snapshot],
  );

  const compareOptions = compareScope === "dong" ? dongOptions : districtOptions;

  const quickAnalysis = useMemo(
    () =>
      customAnalysis ??
      (snapshot
        ? executeQuickAnalysis(snapshot, activeQuick, radiusKm, comparePair)
        : null),
    [snapshot, activeQuick, radiusKm, customAnalysis, comparePair],
  );

  /** 질의에서 행정동을 찾을 때 쓰는 이름 목록(시도 접두어 제거). */
  const dongNamesForQuery = useMemo(
    () => (snapshot ? listDongLabels(snapshot.regions).map((name) => name.split(/\s+/).pop() ?? name) : []),
    [snapshot],
  );

  const populationCube = useMemo(
    () => (snapshot ? populationCubeFromSnapshot(snapshot) : null),
    [snapshot],
  );

  /**
   * 격자 레이어의 경계.
   *
   * 지도는 GeoJSON 폴리곤을 코드로 칠하는 경로 하나뿐이다. 격자도 같은 모양의 사각형
   * GeoJSON으로 만들어 두었으므로, 레이어가 격자일 때 경계만 바꿔 끼우면 채색·클릭·툴팁이
   * 전부 그대로 따라온다. 행정동 경계(3.7MB)와 달리 작아서(브로틀리 33KB) 필요할 때 받는다.
   */
  const [gridBoundary, setGridBoundary] = useState<BoundaryCollection | null>(null);
  const gridBoundaryRequestedRef = useRef(false);
  useEffect(() => {
    if (activeLayerId !== KCB_GRID_LAYER.id || gridBoundaryRequestedRef.current) return;
    gridBoundaryRequestedRef.current = true;
    fetch("/data/grid-500m.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("격자 경계를 불러오지 못했습니다.");
        return response.json() as Promise<BoundaryCollection>;
      })
      .then(setGridBoundary)
      .catch(() => {
        gridBoundaryRequestedRef.current = false;
        setRemoteCubeErrors((prev) => ({ ...prev, [KCB_GRID_LAYER.id]: "격자 경계를 불러오지 못했습니다." }));
      });
  }, [activeLayerId]);

  // 의료취약지수는 스냅샷에서 계산된다. 교차분석에서 민간 지표와 겹쳐 보려면 큐브 모양이어야 한다.
  const medicalCube = useMemo(
    () => (snapshot ? medicalCubeFromSnapshot(snapshot) : null),
    [snapshot],
  );

  const activeLayerMetrics = activeLayerId === "medical" ? [] : CUBE_LAYER_METRICS[activeLayerId];
  const activeMetric =
    activeLayerMetrics.find((metric) => metric.key === activeMetricKey) ?? activeLayerMetrics[0] ?? null;

  /*
   * 손으로 고른 지표에도 자연어 질의와 같은 규칙을 적용한다.
   *
   * 시군구까지만 제공되는 지표(KOSIS e-지방지표 등)는 행정동 셀에 소속 시군구 값이 그대로
   * 복제돼 있다. 행정동으로 두면 같은 값 서른 개를 놓고 「상위 3곳」이라 답하게 된다.
   * 질의로 들어올 때는 이미 시군구로 돌려세우고 있었는데, 버튼으로 고를 때만 안 그랬다.
   */
  const selectMetric = useCallback((metric: MetricDef) => {
    setActiveMetricKey(metric.key);
    if (metric.scope === "sgg") {
      adminLevelSourceRef.current = "user";
      setAdminLevel("sgg");
    }
  }, []);
  // population is derived from the snapshot; every other cube layer is a remote JSON.
  const activeCube =
    activeLayerId === "population"
      ? populationCube
      : activeLayerId === "medical"
        ? null
        : remoteCubes[activeLayerId] ?? null;
  const activeLayerError = activeLayerId === "medical" ? null : remoteCubeErrors[activeLayerId] ?? null;
  const activeLayerProvider = LAYER_PROVIDERS[activeLayerId];

  const layerAnalysisResult = useMemo(() => {
    if (activeLayerId === "medical" || !activeMetric || !activeCube) return null;
    return layerCubeToAnalysisView(activeCube, activeMetric, activeLayerMetrics, adminLevel, layerDirection, layerRegionFilters);
  }, [activeLayerId, activeMetric, activeLayerMetrics, activeCube, adminLevel, layerDirection, layerRegionFilters]);

  /**
   * 선택한 지역이 지금 레이어에 없으면 그 레이어의 1위로 옮긴다.
   *
   * 행정동 레이어끼리는 코드가 같아 선택이 자연스럽게 이어지지만, 격자는 코드가 "gx_gy"라
   * 겹치지 않는다. 그대로 두면 지도가 격자가 없는 옛 행정동을 계속 비춘다 — 격자 레이어로
   * 바꿨는데 화면은 거창군 북상면 산속을 보여주고 있었다(prod 실측).
   */
  /*
   * 사용자가 직접 고르지 않았다면 선택은 늘 이번 분석의 1위를 가리킨다.
   *
   * 이전에는 "순위에 없을 때만" 옮겼는데, 행정동은 어느 지표에서나 순위에 들어 있으므로
   * 한 번 선택된 지역이 분석을 바꿔도 계속 남았다. 그래서 "생활인구 1위는 양산시 물금읍"
   * 이라는 결론 옆에 `선택 278위`와 `거창군 북상면 민간데이터 종합`이 붙어 있었다
   * (prod 실측) — 답과 화면이 서로 다른 지역을 가리켰다.
   */
  /*
   * effect가 아니라 렌더 중에 맞춘다(React가 권하는 "파생 상태 조정" 꼴).
   * effect로 하면 한 번 그린 뒤 다시 그리게 되어, 엉뚱한 지역이 선택된 화면이 한 프레임
   * 스쳐 간다. 아래 조건이 이미 "달라졌을 때만" 세팅하므로 무한 렌더로 가지 않는다.
   */
  const rankedForSelection = layerAnalysisResult?.analysis.ranked;
  if (rankedForSelection && rankedForSelection.length > 0) {
    const keepUserPick =
      followSelection &&
      selectedRegionCode !== null &&
      rankedForSelection.some((row) => row.code === selectedRegionCode);
    if (!keepUserPick && selectedRegionCode !== rankedForSelection[0].code) {
      setSelectedRegionCode(rankedForSelection[0].code);
    }
  }

  // A choropleth layer is "loading" when it's active, its cube hasn't arrived yet,
  // and it hasn't errored out (errors already surface via activeLayerError). While this
  // is true `analysis` must not silently fall back to the medical quickAnalysis.
  const isLayerCubeLoading =
    activeLayerId !== "medical" &&
    !layerAnalysisResult &&
    (activeLayerId === "population" ? populationCube === null : activeCube === null && activeLayerError === null);

  const layerLoadingView = useMemo<AnalysisView | null>(() => {
    if (!isLayerCubeLoading) return null;
    const label = activeMetric?.label ?? activeLayerMetrics[0]?.label ?? "레이어";
    return {
      id: activeLayerId,
      title: `${label} 데이터 로딩 중`,
      summary: `${label} 데이터를 불러오는 중입니다…`,
      ranked: [],
      filteredFacilities: [],
      formulaNotes: [],
      legendLabel: `${label} 분포`,
      isFacilityResult: false,
    };
  }, [isLayerCubeLoading, activeLayerId, activeMetric]);

  const analysis = useMemo<AnalysisView | null>(() => {
    if (activeLayerId !== "medical") {
      if (layerAnalysisResult) return { ...layerAnalysisResult.analysis, id: activeLayerId };
      if (layerLoadingView) return layerLoadingView;
    }
    return quickAnalysis;
  }, [activeLayerId, layerAnalysisResult, layerLoadingView, quickAnalysis]);

  const dismissOnboard = useCallback(() => {
    setShowOnboard(false);
    try {
      window.localStorage.setItem(ONBOARD_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * 처음 온 사람에게 이 도구가 무엇인지 한 번에 보여 준다.
   *
   * 이 도구의 주 용도는 민간데이터(SKT·NH·KCB)를 자연어로 묻는 것이므로, 예시도 그것으로
   * 건다. 질의문을 질문창에 남겨 두어 "이렇게 물으면 되는구나"가 눈에 남게 한다.
   */
  const ONBOARD_EXAMPLE = "생활인구 많은 동네";
  const runOnboardExample = useCallback(() => {
    dismissOnboard();
    setActiveTab("control");
    setCustomAnalysis(null);
    setSelectedFacilityId(null);
    setDrillTrail([]);
    setQuery(ONBOARD_EXAMPLE);

    const match = resolveLayerQuery(ONBOARD_EXAMPLE, PRIVATE_NL_LAYERS, {
      adminLevelFallback: adminLevel,
    });
    if (match) {
      setActiveLayerId(match.layerId as LayerId);
      setActiveMetricKey(match.metricKey);
      setLayerDirection(match.direction);
      setLayerRegionFilters(match.regionFilters);
      if (match.adminLevel !== adminLevel) setAdminLevel(match.adminLevel);
      adminLevelSourceRef.current = "query";
      setQueryNotice(
        `${match.layerLabel} · ${match.metricLabel} 레이어로 전환했습니다 (출처: ${providerSourceLabel(match.provider)}).`,
      );
      setQueryNoticeTone("success");
    }
    setSheetMode("right");
    showToast("생활인구 분석 시작");
  }, [adminLevel, dismissOnboard, showToast]);

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

  const scores = useMemo(() => {
    if (activeLayerId !== "medical" && layerAnalysisResult) {
      return layerAnalysisResult.scores;
    }
    if (activeLayerId !== "medical" && isLayerCubeLoading) {
      return new Map<string, number>();
    }
    return new Map(
      (quickAnalysis?.ranked ?? [])
        .filter((row): row is typeof row & { mapScore: number } => row.mapScore !== null)
        .map((row) => [row.code, row.mapScore]),
    );
  }, [activeLayerId, layerAnalysisResult, isLayerCubeLoading, quickAnalysis]);

  const isCompareView = Boolean(
    activeQuick === "compare" ||
      lastIntent?.tool === "compareRegions" ||
      analysis?.title.includes("지역 비교") ||
      analysis?.title.includes(" vs "),
  );

  const oneLineConclusion = useMemo(() => {
    if (!snapshot || !analysis) return null;
    // 교차분석 순위는 두 지표의 합성 격차 기준이다. 일반 결론 생성기는 metrics[0](= A지표)
    // 이름을 붙여 "A 기준 상위 3곳"이라고 써버려 순위 근거를 오도하므로, 이미 격차를 설명하는
    // 교차 해석문을 그대로 결론으로 쓴다.
    if (analysis.id === "cross") return analysis.summary;
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
      { selectedRegionCode, ascending: analysis.rankDirection === "asc" },
    );
  }, [analysis, selectedRegionCode, snapshot]);

  /**
   * 선택 지역의 민간데이터 종합 프로파일. 레이어를 하나씩 바꿔 보는 방식으로는 "이 동이
   * 전반적으로 어떤 곳인가"를 알기 어려워, 전 지표를 경남 대비 백분위와 함께 한 번에 낸다.
   */
  const regionProfile = useMemo(() => {
    if (!selectedRegionCode || !snapshot) return null;
    const region = snapshot.regions.find((item) => item.adm_cd2 === selectedRegionCode);
    if (!region) return null;
    const cubes: Record<string, LayerCube | null> = { population: populationCube };
    for (const layer of REMOTE_CUBE_LAYERS) cubes[layer.id] = remoteCubes[layer.id] ?? null;
    /*
     * 이 패널의 제목은 「민간데이터 종합」이다. KOSIS(국가통계)까지 넣으면 제목이
     * 거짓말이 되고, KOSIS 지표는 시군구 값이라 행정동 프로파일에 그대로 얹으면
     * 「이 동의 값」으로 읽힌다. 민간 레이어만 쓴다.
     */
    return buildRegionProfile(selectedRegionCode, region.adm_nm, PRIVATE_LAYERS, cubes, trendMonths);
  }, [populationCube, remoteCubes, selectedRegionCode, snapshot, trendMonths]);

  /*
   * 시군구로 합친 결과의 코드는 `4817000000`이라 스냅샷 행정동 목록에 없다. 그래서
   * `regionProfile`이 null이 되고 패널이 **말없이 사라졌다** — 행정동 결과에선 있던 칸이
   * 시군구 결과에선 없어진다(prod 실측, 4차 리포트는 "대응 뷰가 없어서"로 추측했으나
   * 실제로는 조회 실패다).
   *
   * 민간 큐브가 행정동 단위라 시군구 합산 프로파일은 따로 만들어야 한다. 그때까지는
   * 사라진 이유를 밝힌다 — 말없이 없어지는 것이 이 프로젝트에서 가장 나쁜 실패다.
   */
  const profileMissingForDistrict = useMemo(() => {
    if (!selectedRegionCode || !snapshot || regionProfile) return false;
    return !snapshot.regions.some((region) => region.adm_cd2 === selectedRegionCode);
  }, [regionProfile, selectedRegionCode, snapshot]);

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

  const selectedRegion = snapshot?.regions.find((region) => region.adm_cd2 === selectedRegionCode) ?? null;
  const defaultMedicalFacilities = snapshot?.facilities.filter((facility) => facility.type !== "약국") ?? [];
  /*
   * 의료시설 핀은 의료를 물었을 때만 뜻이 있다.
   *
   * 생활인구·카드매출 순위를 보는 화면에도 병의원 4,272곳이 클러스터로 얹혀, 단계구분도
   * 위에 128·83·60 같은 숫자 방울이 떠 있었다(prod 실측). 지금 보는 지표와 아무 관계가
   * 없는 숫자라 지도를 읽는 것을 방해한다.
   */
  const showMedicalFacilities = activeLayerId === "medical";
  const rawMapFacilities = analysis?.isFacilityResult
    ? analysis.filteredFacilities
    : !showMedicalFacilities
      ? []
      : (analysis?.filteredFacilities.length ?? 0) > 0
        ? (analysis?.filteredFacilities ?? [])
        : defaultMedicalFacilities;
  const scopedMapFacilities =
    markerScope === "selected" && selectedRegionCode
      ? rawMapFacilities.filter((facility) => facility.adm_cd2 === selectedRegionCode)
      : rawMapFacilities;
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

  /*
   * 지점 둘레 읽기.
   *
   * 시설은 화면에 그려진 것(`mapFacilities`)이 아니라 **스냅샷 전체**로 센다. 화면 목록은
   * 유형 필터·표시 상한(600곳)이 걸려 있어서, 그것으로 세면 "반경 2km 안 3곳"이 실은
   * "그려진 것 중 3곳"이 된다. 지도에 안 그려졌다고 병원이 없는 것은 아니다.
   */
  const probeFacilities = snapshot?.facilities;
  const probe = useMemo(() => {
    if (!probePoint || !boundary || !probeFacilities) return null;
    return probeRadius({
      point: probePoint,
      radiusKm: probeRadiusKm,
      boundary,
      facilities: probeFacilities,
    });
  }, [boundary, probeFacilities, probePoint, probeRadiusKm]);

  /*
   * 값 조건은 **지표 단위가 맞을 때만** 건다. 사람이 쓴 단위와 지표의 단위가 다른데
   * 숫자만 비교하면 조용히 틀린 필터가 걸린다 — 안 거르는 것보다 나쁘다.
   * 단위가 안 맞으면 여기서 아무것도 하지 않고, 대신 화면에 그 사실을 밝힌다.
   */
  /*
   * 교차·다중조건·추세교차는 여러 지표를 z로 합친 **합성 점수**로 줄을 세운다. 그 순위를
   * 대표하는 단일 지표가 없으므로 값 조건을 걸 자리가 없다. `metrics[0]`은 성분 하나일
   * 뿐인데 그것을 "이 지표의 단위"라고 말하면("단위는 명이라서") 순위가 명 단위인 줄 안다.
   */
  const isComposite = analysis?.compositeRanking === true;
  const thresholdUnitMatches =
    valueThreshold !== null &&
    !isComposite &&
    analysis?.ranked[0]?.metrics[0] !== undefined &&
    baseUnit(analysis.ranked[0].metrics[0].unit) === valueThreshold.unit;

  const filteredRanked = useMemo(() => {
    if (!analysis) return [];
    const q = resultSearch.trim().toLowerCase();
    const bySearch = q
      ? analysis.ranked.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            row.district.toLowerCase().includes(q) ||
            row.code.includes(q),
        )
      : analysis.ranked;
    if (!valueThreshold || !thresholdUnitMatches) return bySearch;
    return bySearch.filter((row) => thresholdMatches(row.metrics[0]?.value ?? null, valueThreshold));
  }, [analysis, resultSearch, valueThreshold, thresholdUnitMatches]);

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

  /*
   * 비율로 물었으면(상위 10%) 행 수에서 개수를 낸다. 질의 시점에는 전체가 몇 개인지
   * 모른다 — 행정동 305개인지 시군구 22개인지가 분석 결과에 달려 있다.
   */
  const effectiveLimit =
    percentLimit !== null && filteredRanked.length > 0
      ? Math.max(1, Math.ceil((filteredRanked.length * percentLimit) / 100))
      : resultLimit;
  /*
   * 값 조건을 어떻게 처리했는지 화면에 밝힌다. 세 갈래다.
   * - 단위가 달라 못 걸렀다 → 순위는 그대로 내고 그 사실을 말한다
   * - 걸렀는데 하나도 없다 → **0행은 "데이터 없음"으로 오독된다.** 조건 때문임을 말하고
   *   전체 1위를 함께 보여 준다
   * - 걸러서 남았다 → 군더더기를 붙이지 않는다
   */
  const queryCaveat = (() => {
    if (!valueThreshold || !analysis) return null;
    if (isComposite) {
      return `여러 지표를 합쳐 줄 세운 결과라 「${valueThreshold.value.toLocaleString("ko-KR")}${valueThreshold.unit}」 같은 값 조건을 걸 자리가 없습니다. 지표 하나로 물으면 걸 수 있습니다.`;
    }
    const metricUnit = analysis.ranked[0]?.metrics[0]?.unit;
    if (!thresholdUnitMatches) {
      return `이 지표의 단위는 ${becauseItIs(metricUnit ?? "다른 단위")} 「${valueThreshold.value.toLocaleString("ko-KR")}${valueThreshold.unit}」 조건을 걸지 못했습니다. 아래는 그 조건을 빼고 낸 순위입니다.`;
    }
    if (filteredRanked.length === 0) {
      const top = analysis.ranked[0];
      return top
        ? `조건에 맞는 곳이 없습니다(데이터가 없는 것이 아닙니다). 전체 1위는 ${top.name} ${top.valueLabel}입니다.`
        : "조건에 맞는 곳이 없습니다.";
    }
    return null;
  })();

  /*
   * 내보내기는 **조건은 반영하되 페이징은 빼야** 한다.
   *
   * 화면은 31행인데 CSV가 305행으로 나가고 있었다(prod 실측) — `analysis.ranked`를 그대로
   * 썼기 때문이다. 사용자는 화면을 보고 내려받는데 파일에는 전혀 다른(더 많은) 데이터가
   * 들어 있다. 반대로 화면에 보이는 24행만 내보내면, 조건 없이 물었을 때 나머지가 잘린다.
   *
   * 갈라야 할 것은 "사용자가 적은 개수·비율"과 "화면이 정한 기본 페이지 크기"다.
   */
  const exportLimit =
    percentLimit !== null && filteredRanked.length > 0
      ? Math.max(1, Math.ceil((filteredRanked.length * percentLimit) / 100))
      : explicitCount;
  const exportRanked = exportLimit ? filteredRanked.slice(0, exportLimit) : filteredRanked;
  /* 보고서의 "대상 N개 중"도 조건을 반영해야 한다. 걸러 놓고 305라 적으면 앞뒤가 안 맞는다. */
  const exportTotal =
    analysis && exportRanked.length !== analysis.ranked.length ? exportRanked.length : analysis?.totalCount;

  const visibleRanked = filteredRanked.slice(0, effectiveLimit);
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

  /*
   * 선택 지역이 바뀌면 그 주변 실시간 장소를 다시 받는다. 외부 시스템(Kakao 장소 API)과
   * 화면 상태를 맞추는 일이라 effect가 제자리다. 결과를 상태에 넣는 것이 이 effect의
   * 목적 자체이므로 setState를 뺄 수 없다.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLivePlacesNearSelection(selectedRegion, "병원");
  }, [selectedRegion, loadLivePlacesNearSelection]);

  /*
   * 조작·결과 패널 여닫이. 좁은 화면이면 패널이 바텀시트라 sheetMode가, 넓은 화면이면
   * 접힘 상태(leftCollapsed)가 여닫이를 맡는다. 한 버튼이 두 모델을 다 다뤄야 하므로
   * 누르는 시점에 어느 쪽인지 본다. CSS 분기점(900px)과 같은 값을 쓴다 — 어긋나면
   * 버튼이 아무 일도 하지 않는 폭 구간이 생긴다.
   */
  const isNarrowNow = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 900px)").matches;

  const toggleControls = useCallback(() => {
    if (isNarrowNow()) setSheetMode((mode) => (mode === "left" ? "none" : "left"));
    else toggleLeft();
  }, [toggleLeft]);

  const toggleResults = useCallback(() => {
    if (isNarrowNow()) setSheetMode((mode) => (mode === "right" ? "none" : "right"));
    else toggleRight();
  }, [toggleRight]);

  const selectFacility = useCallback((facility: Facility) => {
    setSelectedFacilityId(facility.id);
    setSelectedLivePlace(null);
    setFollowSelection(true);
    setSelectedRegionCode(facility.adm_cd2);
  }, []);

  const selectRegion = useCallback(
    (code: string) => {
      setSelectedFacilityId(null);
      setSelectedLivePlace(null);
      setFollowSelection(true);
      // At sgg admin level, ranked rows carry 5-digit sgg codes (map scores stay
      // dong-keyed — see layers/to-analysis-view.ts). Resolve the clicked sgg
      // code to a representative member dong so selection/highlight/facility
      // scoping (all dong-keyed) actually has something to match.
      if (activeLayerId !== "medical" && adminLevel === "sgg") {
        const cube =
          activeLayerId === "population" ? populationCube : remoteCubes[activeLayerId] ?? null;
        const memberDong =
          cube?.cells.find((cell) => cell.code.slice(0, 5) === code)?.code ??
          snapshot?.regions.find((region) => region.adm_cd2.slice(0, 5) === code)?.adm_cd2 ??
          null;
        setSelectedRegionCode(memberDong ?? code);
        return;
      }
      setSelectedRegionCode(code);
    },
    [activeLayerId, adminLevel, populationCube, remoteCubes, snapshot],
  );

  const drillIntoDistrict = useCallback(
    (districtLabel: string) => {
      if (!snapshot) return;
      const token = districtLabel.replace(/^경상남도\s+/, "").trim();
      const intent: AnalysisIntent = {
        tool: "rankHospitalScarcity",
        filters: { regions: [token], limit: Math.min(snapshot.regions.length, 600) },
      };
      const result = executeAnalysisIntent(intent, snapshot);
      const view = resultToView("scarcity", result, `${token} 동 순위 (의료 취약)`);
      setActiveLayerId("medical");
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
    const next = executeQuickAnalysis(snapshot, "compare", radiusKm, comparePair);
    if (next.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
    showToast("지역 비교로 돌아감");
  }, [comparePair, radiusKm, showToast, snapshot]);

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
      const next = executeQuickAnalysis(snapshot, "compare", radiusKm, pair);
      if (next.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
      setSheetMode("right");
      showToast(`${pair[0]} vs ${pair[1]}`);
    },
    [compareScope, radiusKm, showToast, snapshot],
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
      showToast("공유 링크 복사됨");
    } catch {
      setShareNotice("링크 복사에 실패했습니다. 주소창 URL을 복사하세요.");
      showToast("링크 복사 실패");
    }
    window.setTimeout(() => setShareNotice(null), 2500);
  }, [showToast]);

  // 내보내는 표·보고서는 화면에 보이는 분석이다. 민간 큐브 레이어와 교차분석은 공공
  // 스냅샷과 기준월·출처가 다르므로, 스냅샷 값을 그대로 쓰면 잘못된 기준월이 실린다.
  const exportProvenance = useMemo(() => {
    if (!snapshot || !analysis) return null;
    return resolveExportProvenance({
      analysisProvenance: analysis.provenance,
      activeLayer:
        activeLayerId !== "medical" && activeCube
          ? {
              referenceMonth: activeCube.referenceMonth,
              provider: activeLayerProvider,
              label: LAYER_OPTIONS.find((layer) => layer.id === activeLayerId)?.label ?? activeLayerId,
            }
          : null,
      snapshotReferenceMonth: snapshot.referenceMonth,
      snapshotSource: dataSource,
    });
  }, [analysis, activeCube, activeLayerId, activeLayerProvider, dataSource, snapshot]);

  const exportCurrentCsv = useCallback(() => {
    if (!snapshot || !analysis || !exportProvenance) return;
    const { referenceMonth: stamp, source } = exportProvenance;
    if (analysis.isFacilityResult) {
      const csv = facilitiesToCsv(
        analysis.title,
        stamp,
        source,
        snapshot.mode,
        analysis.filteredFacilities.map((facility) => ({
          id: facility.id,
          sido: "경남",
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
      source,
      snapshot.mode,
      exportRanked.map((row, index) => {
        return {
          rank: index + 1,
          code: row.code,
          sido: "경남",
          name: row.name,
          valueLabel: row.valueLabel,
          note: row.note,
        };
      }),
    );
    downloadTextFile(`ralphton-rank-${stamp}.csv`, csv);
    showToast("순위 CSV 저장");
  }, [analysis, exportProvenance, exportRanked, showToast, snapshot]);

  /**
   * 화면의 분석을 보고서용 개조식 마크다운으로 저장하고 클립보드에도 넣는다.
   * CSV는 원자료 첨부용이라 본문에 붙이기 어려워, 요약·표·산식·한계를 갖춘 문단을 만든다.
   */
  /**
   * 내보내기 네 갈래(마크다운·한글·A4·슬라이드)가 쓰는 보고서 재료를 한 자리에서 만든다.
   *
   * 갈래마다 따로 적고 있었다. 「답하지 못했습니다」경고나 모수(totalCount)처럼 **답의
   * 정직성을 지키는 항목**이 한 갈래에만 들어가면, 그 갈래로 내보낸 사람만 단서를 못 본다.
   * 하나로 모아 그럴 수 없게 한다.
   */
  const buildReportInput = useCallback((): ReportInput | null => {
    if (!snapshot || !analysis || !exportProvenance) return null;
    return {
      title: analysis.title,
      summary: oneLineConclusion ?? analysis.summary,
      referenceMonth: exportProvenance.referenceMonth,
      source: exportProvenance.source,
      mode: snapshot.mode,
      formulaNotes: answeredLastQuery
        ? analysis.formulaNotes
        : [
            "⚠ 마지막 질의에는 답하지 못했습니다. 아래는 그 직전 분석 결과입니다.",
            ...analysis.formulaNotes,
          ],
      rows: exportRanked.map((row, index) => ({
        rank: index + 1,
        code: row.code,
        name: row.name,
        valueLabel: row.valueLabel,
        note: row.note,
      })),
      totalCount: exportTotal,
      exportedAt: new Date().toLocaleString("ko-KR"),
    };
  }, [
    analysis,
    answeredLastQuery,
    exportProvenance,
    exportRanked,
    exportTotal,
    oneLineConclusion,
    snapshot,
  ]);

  /**
   * A4로 인쇄되는 HTML 보고서.
   *
   * 한글 붙여넣기용과 목적이 다르다 — 이쪽은 열어서 그대로 인쇄하거나 PDF로 저장하는
   * 완성본이다. 화면은 어두운 테마지만 인쇄본은 늘 흰 바탕이다(어두운 색을 그대로
   * 인쇄하면 토너를 붓거나 흰 글씨가 흰 종이에 찍힌다).
   */
  const exportCurrentA4 = useCallback(() => {
    const reportInput = buildReportInput();
    if (!reportInput || !exportProvenance) return;
    downloadTextFile(
      `ralphton-a4-${exportProvenance.referenceMonth}.html`,
      buildA4HtmlReport(reportInput),
      "text/html;charset=utf-8",
    );
    showToast("A4 보고서 저장 — 열어서 인쇄·PDF 저장");
  }, [buildReportInput, exportProvenance, showToast]);

  const exportCurrentReport = useCallback(async () => {
    if (!snapshot || !analysis || !exportProvenance) return;
    const reportInput = buildReportInput();
    if (!reportInput) return;
    const markdown = buildMarkdownReport(reportInput);

    downloadTextFile(
      `ralphton-report-${exportProvenance.referenceMonth}.md`,
      markdown,
      "text/markdown;charset=utf-8",
    );
    try {
      await navigator.clipboard.writeText(markdown);
      showToast("보고서 저장·복사");
    } catch {
      // 클립보드가 막힌 환경에서도 파일 저장은 이미 끝났다.
      showToast("보고서 저장");
    }
  }, [
    analysis,
    answeredLastQuery,
    exportProvenance,
    exportRanked,
    exportTotal,
    oneLineConclusion,
    showToast,
    snapshot,
  ]);

  /**
   * 한글(HWP) 붙여넣기용 내보내기. 마크다운 표는 한글에 붙이면 평문이 되지만, HTML
   * 클립보드는 한글이 진짜 표로 받는다. 같은 내용을 .doc(HTML)로도 저장해 파일로도 열 수 있게 한다.
   */
  const exportCurrentHwp = useCallback(async () => {
    if (!snapshot || !analysis || !exportProvenance) return;
    const reportInput = buildReportInput();
    if (!reportInput) return;
    const html = buildHwpHtmlReport(reportInput);
    downloadTextFile(
      `ralphton-report-${exportProvenance.referenceMonth}.doc`,
      html,
      "application/msword;charset=utf-8",
    );
    const copied = await copyHtmlToClipboard(html, buildMarkdownReport(reportInput));
    showToast(copied ? "한글 문서 저장·표 복사" : "한글 문서 저장");
  }, [
    analysis,
    answeredLastQuery,
    exportProvenance,
    exportRanked,
    exportTotal,
    oneLineConclusion,
    showToast,
    snapshot,
  ]);

  /**
   * 발표용 슬라이드(표지·핵심결과·근거 3장) 내보내기. PPTX 바이너리 대신 파워포인트·한글이
   * 모두 여는 HTML로 만든다 — 브라우저 인쇄로 PDF 배포가 되고 표는 복사해 붙일 수 있다.
   */
  const exportCurrentSlides = useCallback(() => {
    if (!snapshot || !analysis || !exportProvenance) return;
    const html = buildSlideHtml({
      title: analysis.title,
      summary: oneLineConclusion ?? analysis.summary,
      referenceMonth: exportProvenance.referenceMonth,
      source: exportProvenance.source,
      mode: snapshot.mode,
      formulaNotes: answeredLastQuery
        ? analysis.formulaNotes
        : [
            "⚠ 마지막 질의에는 답하지 못했습니다. 아래는 그 직전 분석 결과입니다.",
            ...analysis.formulaNotes,
          ],
      rows: exportRanked.map((row, index) => ({
        rank: index + 1,
        code: row.code,
        name: row.name,
        valueLabel: row.valueLabel,
        note: row.note,
      })),
      totalCount: exportTotal,
      exportedAt: new Date().toLocaleString("ko-KR"),
    });
    downloadTextFile(
      `ralphton-slides-${exportProvenance.referenceMonth}.html`,
      html,
      "text/html;charset=utf-8",
    );
    showToast("슬라이드 저장 (브라우저에서 열어 인쇄→PDF)");
  }, [
    analysis,
    answeredLastQuery,
    exportProvenance,
    exportRanked,
    exportTotal,
    oneLineConclusion,
    showToast,
    snapshot,
  ]);

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
      setFollowSelection(false);
      if (id === "reset") {
        setActiveQuick("scarcity");
        const next = snapshot
          ? executeQuickAnalysis(snapshot, "scarcity", 2, comparePair)
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
        ? executeQuickAnalysis(snapshot, id, radiusKm, comparePair)
        : null;
      if (next?.ranked[0]) setSelectedRegionCode(next.ranked[0].code);
      else if (next?.filteredFacilities[0]) {
        setSelectedRegionCode(next.filteredFacilities[0].adm_cd2);
        setSelectedFacilityId(next.filteredFacilities[0].id);
      }
      setActiveTab("control");
      if (id === "compare") setSheetMode("right");
    },
    [comparePair, radiusKm, snapshot],
  );

  const runRadius = useCallback(
    (radius: 1 | 2 | 3) => {
      setRadiusKm(radius);
      setActiveQuick("radius");
      setCustomAnalysis(null);
      setSelectedFacilityId(null);
      const next = snapshot
        ? executeQuickAnalysis(snapshot, "radius", radius, comparePair)
        : null;
      setSelectedRegionCode(next?.ranked[0]?.code ?? selectedRegionCode);
    },
    [comparePair, selectedRegionCode, snapshot],
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

  /**
   * Execute a resolved cross-layer analysis. Shared by the NL path (submitQuery) and the
   * one-click 교차분석 presets so both render identically. Returns false when a required
   * cube hasn't loaded yet.
   */
  /**
   * 통계 질의(상관·이상치)를 실행한다.
   *
   * 순위표가 아니라 **관계와 예외**를 답하는 자리다. 큐브가 아직 없으면 false를 돌려
   * 호출부가 받아 온 뒤 다시 부르게 한다 — 조용히 다른 답으로 흘리지 않는다.
   */
  const runStats = useCallback(
    (stats: StatsQueryMatch, query: string): boolean => {
      const cubeFor = (id: string) =>
        id === "population" ? populationCube : id === "medical" ? medicalCube : remoteCubes[id] ?? null;
      const refFor = (layerId: string, metricKey: string) => {
        const cube = cubeFor(layerId);
        const metrics = CUBE_LAYER_METRICS[layerId];
        const metric = metrics?.find((candidate) => candidate.key === metricKey);
        return cube && metric && metrics ? { cube, metric, metrics } : null;
      };

      let view: StatsView;
      // 점수가 없는 결과라 해석문이 대신 말할 값. 상관이면 A축, 이상치면 그 지표다.
      let statsMetric: { label: string; unit: string; formula: string; referenceMonth: string };
      if (stats.kind === "correlation") {
        const a = refFor(stats.a.layerId, stats.a.metricKey);
        const b = refFor(stats.b.layerId, stats.b.metricKey);
        if (!a || !b) return false;
        view = correlationView(stats, a, b, { asksCausation: asksCausation(query) });
        statsMetric = {
          label: stats.a.metricLabel,
          unit: a.metric.unit,
          formula: a.metric.formula,
          referenceMonth: a.cube.referenceMonth,
        };
      } else {
        const ref = refFor(stats.ref.layerId, stats.ref.metricKey);
        if (!ref) return false;
        view = outlierView(stats, ref);
        statsMetric = {
          label: stats.ref.metricLabel,
          unit: ref.metric.unit,
          formula: ref.metric.formula,
          referenceMonth: ref.cube.referenceMonth,
        };
      }

      /*
       * 결과는 기존 결과 패널을 그대로 쓴다. 지도는 건드리지 않는다 — 상관은 지역별
       * 값이 아니라 지표 사이의 값이라 칠할 것이 없고, 억지로 칠하면 "이 색이 상관"으로
       * 읽힌다.
       */
      setCustomAnalysis({
        id: "cross",
        title: view.title,
        summary: view.summary,
        ranked: view.rows.slice(0, 30).map((row) => {
          const name = row.name.replace(/^경상남도\s*/, "");
          return {
            code: row.code,
            name,
            district: name.split(/\s+/)[0] ?? "지역",
            mapScore: null,
            valueLabel: row.detail,
            note: "",
            /*
             * 점수가 없으니 해석문이 대신 말할 값을 준다. 상관이면 A축 값, 이상치면 그
             * 지표 값이다 — 「1위 창원시(30.6%)」처럼 실제로 잰 것이 나온다.
             */
            metrics: [
              {
                label: statsMetric.label,
                value: row.score,
                unit: statsMetric.unit,
                formula: statsMetric.formula,
                referenceMonth: statsMetric.referenceMonth,
                limitation: view.notes[0] ?? "",
              },
            ],
          };
        }),
        filteredFacilities: [],
        formulaNotes: view.notes,
        legendLabel: view.title,
        compositeRanking: true,
        isFacilityResult: false,
        // 없으면 화면이 활성 레이어 기준으로 단위를 추측해 시군구 결과를 「행정동」이라 적는다.
        unitWord: view.unitWord,
      });
      setActiveTab("control");
      if (stats.adminLevel !== adminLevel) setAdminLevel(stats.adminLevel);
      adminLevelSourceRef.current = "query";
      setLastIntent(null);
      setParseStage("done");
      setQueryNotice(
        stats.kind === "correlation"
          ? `상관분석 · ${stats.a.metricLabel} × ${stats.b.metricLabel} (${stats.unit === "sgg" ? "시군구" : "행정동"} 단위)`
          : `이상치 · ${stats.ref.metricLabel} (${stats.unit === "sgg" ? "시군구" : "행정동"} 단위)`,
      );
      setQueryNoticeTone("success");
      setQuerySuggestions([]);
      window.setTimeout(() => setParseStage("idle"), 1200);
      return true;
    },
    [adminLevel, medicalCube, populationCube, remoteCubes],
  );

  const runCross = useCallback(
    (cross: CrossQueryMatch): boolean => {
      const cubeFor = (id: string) =>
        id === "population" ? populationCube : id === "medical" ? medicalCube : remoteCubes[id] ?? null;
      const cubeA = cubeFor(cross.a.layerId);
      const cubeB = cubeFor(cross.b.layerId);
      const metricsA = CUBE_LAYER_METRICS[cross.a.layerId as CubeLayerId];
      const metricsB = CUBE_LAYER_METRICS[cross.b.layerId as CubeLayerId];
      const metricA = metricsA?.find((metric) => metric.key === cross.a.metricKey);
      const metricB = metricsB?.find((metric) => metric.key === cross.b.metricKey);
      if (!cubeA || !cubeB || !metricA || !metricB) return false;

      const result = crossLayerView(
        { cube: cubeA, metric: metricA, metrics: metricsA },
        { cube: cubeB, metric: metricB, metrics: metricsB },
        cross.mode,
        cross.adminLevel,
        cross.regionFilters,
      );
      const view = crossResultToView(
        result,
        { provider: cross.a.provider, metric: metricA, referenceMonth: cubeA.referenceMonth },
        { provider: cross.b.provider, metric: metricB, referenceMonth: cubeB.referenceMonth },
        cross.mode,
      );
      setActiveLayerId("medical");
      setCustomAnalysis(view);
      setActiveTab("control");
      if (cross.adminLevel !== adminLevel) setAdminLevel(cross.adminLevel);
      adminLevelSourceRef.current = "query";
      if (view.ranked[0]) setSelectedRegionCode(view.ranked[0].code);
      setLastIntent(null);
      setParseStage("done");
      setQueryNotice(
        `교차분석 · ${cross.a.metricLabel}(${cross.a.provider}) ${cross.mode === "gap" ? "대비" : "×"} ${cross.b.metricLabel}(${cross.b.provider}) — ${cross.regionFilters.length ? `${cross.regionFilters.join("·")} 안 ` : ""}${view.ranked.length}개 ${unitWordOf(cross.a.layerId, cross.adminLevel)}`,
      );
      setQueryNoticeTone("success");
      setQuerySuggestions([]);
      window.setTimeout(() => setParseStage("idle"), 1200);
      return true;
    },
    [adminLevel, medicalCube, populationCube, remoteCubes],
  );

  /**
   * 세 지표 이상을 겹쳐 실행한다. 큐브가 하나라도 아직 없으면 false를 돌려, 호출부가
   * 필요한 큐브를 받아 와 다시 태우게 한다(2지표 교차와 같은 규약).
   */
  const runMulti = useCallback(
    (match: MultiQueryMatch): boolean => {
      const cubeFor = (id: string) =>
        id === "population" ? populationCube : id === "medical" ? medicalCube : remoteCubes[id] ?? null;

      const prepared = match.operands.map((operand) => {
        const cube = cubeFor(operand.layerId);
        const metrics = CUBE_LAYER_METRICS[operand.layerId as CubeLayerId];
        const metric = metrics?.find((item) => item.key === operand.metricKey);
        return { operand, cube, metrics, metric };
      });
      if (prepared.some((item) => !item.cube || !item.metric || !item.metrics)) return false;

      const result = multiLayerView(
        prepared.map((item) => ({
          cube: item.cube!,
          metric: item.metric!,
          metrics: item.metrics!,
          direction: item.operand.direction,
        })),
        match.adminLevel,
        match.regionFilters,
      );
      const view = multiResultToView(
        result,
        prepared.map((item) => ({
          provider: item.operand.provider,
          metric: item.metric!,
          referenceMonth: item.cube!.referenceMonth,
          direction: item.operand.direction,
        })),
        match.adminLevel,
      );

      setActiveLayerId("medical");
      setCustomAnalysis(view);
      setActiveTab("control");
      if (match.adminLevel !== adminLevel) setAdminLevel(match.adminLevel);
      adminLevelSourceRef.current = "query";
      if (view.ranked[0]) setSelectedRegionCode(view.ranked[0].code);
      setLastIntent(null);
      setParseStage("done");
      setQueryNotice(
        `다중조건 · ${match.operands.map((operand) => `${operand.metricLabel}(${operand.provider})`).join(" × ")} — ${
          match.regionFilters.length ? `${match.regionFilters.join("·")} 안 ` : ""
        }${result.comparable.toLocaleString("ko-KR")}개 ${unitWordOf(match.operands[0].layerId, match.adminLevel)}`,
      );
      setQueryNoticeTone(result.comparable === 0 ? "error" : "success");
      setQuerySuggestions([]);
      window.setTimeout(() => setParseStage("idle"), 1200);
      return true;
    },
    [adminLevel, medicalCube, populationCube, remoteCubes],
  );

  /** One-click 교차분석 preset: resolve its canned query, then run it through runCross. */
  const runCrossPreset = useCallback(
    (presetQuery: string) => {
      const cross = resolveCrossQuery(presetQuery, CROSS_LAYERS, { adminLevelFallback: adminLevel });
      if (!cross || !runCross(cross)) {
        setQueryNotice("민간데이터 레이어를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
        setQueryNoticeTone("neutral");
      }
    },
    [adminLevel, runCross],
  );

  /**
   * 추세 분석을 실행한다. 자연어 경로와 원클릭 프리셋이 공유해, 문장을 직접 입력한 것과
   * 버튼을 누른 것의 결과가 갈릴 수 없게 한다. 큐브가 아직 없으면 false를 돌린다.
   */
  const runTrend = useCallback(
    (trendMatch: TrendQueryMatch): boolean => {
    const cube = remoteCubes[trendMatch.layerId] ?? null;
    const metrics = CUBE_LAYER_METRICS[trendMatch.layerId as CubeLayerId];
    const metric = metrics?.find((item) => item.key === trendMatch.metricKey);
    if (cube && metric) {
      // 질의에 기간이 적혀 있으면 화면 설정보다 그것을 따른다.
      const months = trendMatch.months ?? trendMonths;
      const result = buildTrendRanking(
        cube,
        metric,
        metrics,
        trendMatch.direction,
        trendMatch.adminLevel,
        months,
      );
      const directionLabel = trendMatch.direction === "rising" ? "증가" : "감소";
      // 화면마다 기준이 다르면 혼란스러우므로 프로파일과 같은 기간을 쓰고, 그 사실을 밝힌다.
      const periodLabel = months > 0 ? ` (최근 ${months}개월)` : "";
      const view: AnalysisView = {
        id: "cross",
        title: `${trendMatch.metricLabel} ${directionLabel} 추세${periodLabel}`,
        summary:
          result.ranked.length === 0
            ? `${trendMatch.metricLabel} 추세를 낼 수 있는 지역 없음`
            : // 질의 방향으로 실제 움직인 지역이 하나도 없을 수 있다. 그때 "감소폭이 큰 순"만
              // 쓰면 1위가 오히려 오른 지역이어도 감소한 것처럼 읽힌다(prod에서 실제로 나왔다).
              (() => {
                const wanted = trendMatch.direction === "rising" ? 1 : -1;
                const moved = result.ranked.filter(
                  (row) => (row.trend.changeRate ?? 0) * wanted > 0,
                ).length;
                const top = result.ranked[0];
                const lead =
                  moved === 0
                    ? `${trendMatch.metricLabel}(${trendMatch.provider})이 ${directionLabel}한 지역은 없음. 가장 ${directionLabel}에 가까운 순. `
                    : `${trendMatch.metricLabel}(${trendMatch.provider}) ${directionLabel}폭이 큰 순(${moved}곳 ${directionLabel}). `;
                // 변화율은 분모가 작을수록 크게 튄다. 상위가 소규모 지역에 쏠렸으면 밝힌다.
                const skew =
                  result.smallBaseInTop >= 6
                    ? ` 다만 상위 10곳 중 ${result.smallBaseInTop}곳이 기저가 작은 지역(하위 25%)이라 변화율이 크게 잡힌다.`
                    : "";
                return (
                  lead +
                  `1위 ${topicOf(top.name.replace(/^경상남도\s*/, ""))} ` +
                  describeTrend(top.trend, trendMatch.metricLabel, trendMatch.unit) +
                  skew
                );
              })(),
        ranked: result.ranked.slice(0, 30).map((row) => {
          const name = row.name.replace(/^경상남도\s*/, "");
          const rate = row.trend.changeRate ?? 0;
          return {
            code: row.code,
            name,
            district: name.split(/\s+/)[0] ?? "지역",
            mapScore: result.scores.get(row.code) ?? 0,
            valueLabel: `${rate > 0 ? "+" : ""}${rate.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`,
            note: describeTrend(row.trend, trendMatch.metricLabel, trendMatch.unit),
            metrics: [
              {
                label: `${trendMatch.metricLabel} 변화율`,
                value: rate,
                unit: "%",
                formula: `기간 첫 관측월 대비 최근월 변화율 (${trendMatch.provider})`,
                referenceMonth: cube.referenceMonth,
                limitation: "월별 등락이 있어 ±3% 이내는 보합으로 본다",
              },
            ],
          };
        }),
        filteredFacilities: [],
        formulaNotes: [
          `변화율 = (최근월 − 첫 관측월) ÷ |첫 관측월| × 100${periodLabel}`,
          `${trendMatch.metricLabel}: ${metric.formula} (${trendMatch.provider})`,
          result.excluded > 0
            ? `관측이 2개월 미만이거나 첫 값이 0이라 변화율을 낼 수 없는 ${result.excluded.toLocaleString("ko-KR")}개 ${unitWordOf(trendMatch.layerId, trendMatch.adminLevel)}을 순위에서 제외했다(0에서 시작한 값의 변화율은 나눗셈이 되지 않는다)`
            : "관측이 2개월 미만이거나 첫 값이 0인 지역은 추세를 산출하지 않고 순위에서 제외한다",
        ],
        legendLabel: `${trendMatch.metricLabel} ${directionLabel}폭`,
        isFacilityResult: false,
        totalCount: result.comparable,
        provenance: {
          referenceMonth: cube.referenceMonth,
          source: `${trendMatch.provider} ${trendMatch.metricLabel} 추세`,
        },
      };
      setActiveLayerId("medical");
      setCustomAnalysis(view);
      setActiveTab("control");
      if (trendMatch.adminLevel !== adminLevel) setAdminLevel(trendMatch.adminLevel);
      if (view.ranked[0]) setSelectedRegionCode(view.ranked[0].code);
      setLastIntent(null);
      setParseStage("done");
      setQueryNotice(
        `${trendMatch.metricLabel}(${trendMatch.provider}) ${directionLabel} 추세 — 비교 가능 ${result.comparable}개 ${unitWordOf(trendMatch.layerId, trendMatch.adminLevel)}`,
      );
      setQueryNoticeTone("success");
      setQuerySuggestions([]);
      window.setTimeout(() => setParseStage("idle"), 1200);
      return true;
    }
    return false;
  },
    [adminLevel, remoteCubes, trendMonths],
  );

  /** 원클릭 추세 프리셋: 자연어와 같은 리졸버를 거쳐 실행한다. */
  const runTrendPreset = useCallback(
    (presetQuery: string) => {
      const match = resolveTrendQuery(presetQuery, PRIVATE_NL_LAYERS, {
        adminLevelFallback: adminLevel,
      });
      if (!match || !runTrend(match)) {
        setQueryNotice("민간데이터 레이어를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
        setQueryNoticeTone("neutral");
      }
    },
    [adminLevel, runTrend],
  );



  /**
   * 질의문 하나를 해석해 실행한다.
   *
   * 폼 제출과 공유 링크 복원이 같은 경로를 쓰게 하려고 따로 뺐다. 전에는 복원이 질문만
   * 입력창에 채우고 실행하지 않아, "평균소득 낮은 동"을 공유하면 열었을 때 기본 의료
   * 분석이 떠 있었다(prod 실측). 링크를 보고서에 붙이는 용도라 그러면 쓸모가 없다.
   */
  /**
   * 두 지표의 변화를 겹쳐 본다("생활인구는 느는데 소비는 주는 곳").
   *
   * 값의 크기를 겹치는 교차분석과 달리 변화율을 겹친다. 이 경로가 없어 생활인구 단순
   * 순위로 답하고 있었다 — 물어본 것과 다른 답이다. 큐브가 아직 없으면 false를 돌린다.
   */
  const runTrendCross = useCallback(
    (match: TrendCrossMatch): boolean => {
      const cubeFor = (id: string) =>
        id === "population" ? populationCube : id === "medical" ? medicalCube : remoteCubes[id] ?? null;
      const cubeA = cubeFor(match.a.layerId);
      const cubeB = cubeFor(match.b.layerId);
      const metricsA = CUBE_LAYER_METRICS[match.a.layerId];
      const metricsB = CUBE_LAYER_METRICS[match.b.layerId];
      const metricA = metricsA?.find((item) => item.key === match.a.metricKey);
      const metricB = metricsB?.find((item) => item.key === match.b.metricKey);
      if (!cubeA || !cubeB || !metricA || !metricB) return false;

      const months = match.months ?? trendMonths;
      const result = trendCrossView(
        { cube: cubeA, metric: metricA, metrics: metricsA, direction: match.a.direction },
        { cube: cubeB, metric: metricB, metrics: metricsB, direction: match.b.direction },
        match.adminLevel,
        months,
        match.regionFilters,
      );

      const word = (d: "rising" | "falling") => (d === "rising" ? "증가" : "감소");
      const periodLabel = months > 0 ? ` (최근 ${months}개월)` : "";
      const unitLabel = unitWordOf(match.a.layerId, match.adminLevel);
      const top = result.ranked[0];
      const view: AnalysisView = {
        id: "cross",
        title: `${match.a.metricLabel} ${word(match.a.direction)} × ${match.b.metricLabel} ${word(match.b.direction)}${periodLabel}`,
        // 추세 교차도 두 지표를 겹친 합성이다. 단일 지표 추세와 달리 값 조건을 걸 자리가 없다.
        compositeRanking: true,
        summary:
          result.ranked.length === 0
            ? "두 지표 모두 추세를 낼 수 있는 지역이 없음"
            : // 요구를 다 만족하는 곳이 없을 수 있다. 그때 "가장 가까운 순"이라고 밝혀야
              // 1위가 실제로 그런 곳이라고 읽히지 않는다.
              (result.matching === 0
                ? `${match.a.metricLabel} ${word(match.a.direction)}·${match.b.metricLabel} ${word(match.b.direction)}를 모두 만족하는 ${unitLabel} 없음. 가장 가까운 순. `
                : `${match.a.metricLabel} ${word(match.a.direction)}·${match.b.metricLabel} ${word(match.b.direction)}가 겹치는 순(${result.matching}곳 해당). `) +
              `1위 ${topicOf(top.name.replace(/^경상남도\s*/, ""))} ${match.a.metricLabel} ${top.rateA > 0 ? "+" : ""}${top.rateA.toFixed(1)}% · ${match.b.metricLabel} ${top.rateB > 0 ? "+" : ""}${top.rateB.toFixed(1)}%`,
        ranked: result.ranked.slice(0, 30).map((row) => {
          const name = row.name.replace(/^경상남도\s*/, "");
          return {
            code: row.code,
            name,
            district: name.split(/\s+/)[0] ?? "지역",
            mapScore: result.scores.get(row.code) ?? 0,
            valueLabel: `${row.rateA > 0 ? "+" : ""}${row.rateA.toFixed(1)}% / ${row.rateB > 0 ? "+" : ""}${row.rateB.toFixed(1)}%`,
            note: `${match.a.metricLabel} ${row.rateA > 0 ? "+" : ""}${row.rateA.toFixed(1)}% · ${match.b.metricLabel} ${row.rateB > 0 ? "+" : ""}${row.rateB.toFixed(1)}%`,
            metrics: [
              {
                label: `${match.a.metricLabel} 변화율`,
                value: row.rateA,
                unit: "%",
                formula: `기간 첫 관측월 대비 최근월 변화율 (${match.a.provider})`,
                referenceMonth: cubeA.referenceMonth,
                limitation: "월별 등락이 있어 ±3% 이내는 보합으로 본다",
              },
              {
                label: `${match.b.metricLabel} 변화율`,
                value: row.rateB,
                unit: "%",
                formula: `기간 첫 관측월 대비 최근월 변화율 (${match.b.provider})`,
                referenceMonth: cubeB.referenceMonth,
                limitation: "월별 등락이 있어 ±3% 이내는 보합으로 본다",
              },
            ],
          };
        }),
        filteredFacilities: [],
        legendLabel: `${match.a.metricLabel}·${match.b.metricLabel} 변화 합성점수`,
        isFacilityResult: false,
        formulaNotes: [
          `합성점수 = z(${match.a.metricLabel} ${word(match.a.direction)}폭) + z(${match.b.metricLabel} ${word(match.b.direction)}폭)`,
          `${match.a.metricLabel}: ${metricA.formula} (${match.a.provider})`,
          `${match.b.metricLabel}: ${metricB.formula} (${match.b.provider})`,
          "각 지표는 물어본 방향으로 부호를 맞춰 표준화한다",
        ],
        totalCount: result.comparable,
      };

      setActiveLayerId("medical");
      setCustomAnalysis(view);
      setActiveTab("control");
      if (match.adminLevel !== adminLevel) setAdminLevel(match.adminLevel);
      adminLevelSourceRef.current = "query";
      if (view.ranked[0]) setSelectedRegionCode(view.ranked[0].code);
      setLastIntent(null);
      setParseStage("done");
      setQueryNotice(
        `추세 교차 · ${match.a.metricLabel} ${word(match.a.direction)} × ${match.b.metricLabel} ${word(match.b.direction)} — ${match.regionFilters.length ? `${match.regionFilters.join("·")} 안 ` : ""}${result.comparable}개 ${unitLabel}`,
      );
      setQueryNoticeTone("success");
      setQuerySuggestions([]);
      window.setTimeout(() => setParseStage("idle"), 1200);
      return true;
    },
    [adminLevel, medicalCube, populationCube, remoteCubes, trendMonths],
  );

  // 실행 함수를 담아 두면 그 클로저가 옛 remoteCubes를 붙잡아 큐브가 와도 없다고 본다.
  // 그래서 무엇을 물었는지(match)만 남기고, 실행은 지금 시점의 콜백으로 한다.
  /*
   * 기다리던 큐브가 도착하면 그때 미뤄 둔 질의를 실행한다. "데이터가 왔는가"라는 외부
   * 사건에 반응하는 일이라 effect가 제자리이고, 실행 결과를 상태에 반영하는 것이 목적이다.
   */
  /* eslint-disable react-hooks/set-state-in-effect -- 실행 결과를 상태에 반영하는 것이 이 effect의 목적이다. */
  useEffect(() => {
    if (!pendingCubeQuery) return;
    const ok =
      pendingCubeQuery.kind === "trend"
        ? runTrend(pendingCubeQuery.match)
        : pendingCubeQuery.kind === "trendCross"
          ? runTrendCross(pendingCubeQuery.match)
          : pendingCubeQuery.kind === "multi"
            ? runMulti(pendingCubeQuery.match)
            : pendingCubeQuery.kind === "stats"
              ? runStats(pendingCubeQuery.match, pendingCubeQuery.query)
              : runCross(pendingCubeQuery.match);
    if (!ok) return; // 아직 다 안 왔다. 다음 큐브 도착 때 다시 본다.
    setPendingCubeQuery(null);
    setQueryNotice(null);
    setParseStage("done");
  }, [pendingCubeQuery, runTrend, runCross, runTrendCross, runMulti, runStats]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const runQueryText = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    /*
     * 기본 단위는 **질의를 던지는 이 시점에** 정한다.
     *
     * 렌더 중에 ref를 읽어 미리 구해 두면, 그 렌더가 버려졌을 때 실제로 화면에 반영된 것과
     * 다른 값이 남을 수 있다(React 19 동시 렌더). 여기서 읽으면 늘 최신이고, 이 값은 어차피
     * 질의 실행에만 쓰인다.
     */
    const fallbackAdminLevel = adminLevelSourceRef.current === "user" ? adminLevel : "dong";

    // 새 질의는 새 분포다. 앞 질의에서 확대해 둔 자리에 갇히지 않게 전체 보기로 돌린다.
    setFollowSelection(false);

    /*
     * "상위 5곳만"처럼 개수를 지정했으면 그만큼만 보여 준다. 지정이 없으면 기본으로
     * 되돌린다 — 앞 질의의 5곳이 다음 질의까지 따라오면, 물어보지도 않은 개수로 잘린
     * 결과를 보게 된다(단위가 새던 것과 같은 종류의 결함).
     */
    const asked = detectResultCount(trimmed);
    setExplicitCount(asked);
    setResultLimit(asked ?? RESULT_PAGE_STEP);
    setPercentLimit(detectPercentLimit(trimmed));
    setValueThreshold(detectValueThreshold(trimmed));


    /*
     * 경남 밖 지역을 물었으면 여기서 멈춘다.
     *
     * 이 검사는 공공 도구 파싱 안에만 있었는데, 민간 경로가 그보다 먼저 반환해서
     * "부산 소득 높은 곳"이 아무 경고 없이 경남 순위를 답하고 있었다(prod 실측).
     * 부산·울산은 바로 옆이라 실제로 물을 법한 지역이라 더 위험하다.
     */
    /*
     * ⚠️ 아래 네 갈래(범위 밖·차원 없음·시설 없음·지표 없음)는 **답하지 못한 질의**다.
     * 여기서 rememberQuery 를 부르면 답 못 한 말이 「최근 질문」 칩으로 돌아와 다시
     * 누를거리가 된다. 오타로 아무것도 못 찾은 말까지 제품 문구처럼 나란히 서서,
     * 실제로 자기 입력(「의려취약지역」)을 우리 오타로 읽는 일이 있었다.
     * 기억은 **답을 받은 질의**에만 남긴다.
     */
    const outOfScope = detectOutOfScopePlace(trimmed);
    if (outOfScope) {
      setParseStage("idle");
      setQueryNotice(
        `"${outOfScope}"은(는) 경남 지역 범위 밖입니다. 이 도구는 경남 305개 행정동만 다룹니다.`,
      );
      setQueryNoticeTone("error");
      setAnsweredLastQuery(false);
      return;
    }

    /*
     * 없는 차원을 물었으면 여기서 멈춘다. 범위 밖 지역과 같은 이유다 — 답할 수 없는 것을
     * 답할 수 있는 다른 것으로 바꿔 답하면, 사용자는 그것이 답인 줄 안다.
     */
    const unsupported = detectUnsupportedDimension(trimmed);
    if (unsupported) {
      setParseStage("idle");
      setQueryNotice(
        `"${unsupported}"은(는) 이 데이터로 답할 수 없습니다. 큐브가 월 단위 집계라 요일·시간대 구분이 없습니다. 월 단위로 바꿔 물어보세요 — 예: "생활인구 많은 동".`,
      );
      setQueryNoticeTone("error");
      setAnsweredLastQuery(false);
      return;
    }

    /*
     * 위치 데이터가 없는 시설을 물었으면 여기서 멈춘다. 그러지 않으면 반경검색이 기본값인
     * 의료기관을 대신 세거나("편의점" → 의료기관 수), 큐브 지표에서는 공간 조건이 통째로
     * 사라져 무조건부 순위와 똑같은 답이 나온다.
     */
    const noPoi = detectUnsupportedFacility(trimmed);
    if (noPoi) {
      setParseStage("idle");
      setQueryNotice(
        `"${noPoi}" 위치 데이터가 없습니다. 이 도구가 가진 시설은 의료기관(병원·의원·약국·치과·한의원·보건소)뿐입니다. 소비·인구 지표로 바꿔 물어보세요.`,
      );
      setQueryNoticeTone("error");
      setAnsweredLastQuery(false);
      return;
    }

    /*
     * 비슷한 지표는 있지만 물어본 그것이 없으면, 가진 것을 대신 내놓지 말고 이름을 밝힌다.
     * 비율을 물었는데 건수로 답하면 인구 많은 동네가 그냥 이긴다.
     */
    const missing = detectMissingMetric(trimmed);
    if (missing) {
      setParseStage("idle");
      setQueryNotice(
        `${missing.label} 지표가 없습니다. 이 도구에 있는 것은 ${missing.have}이고, 둘은 다른 값입니다. ${missing.have}(으)로 보시겠다면 그렇게 물어보세요.`,
      );
      setQueryNoticeTone("error");
      setAnsweredLastQuery(false);
      return;
    }

    /*
     * 공공 도구가 정확히 답할 수 있는 질의는 민간 큐브 경로를 건너뛴다. 큐브 트리거가
     * 더 짧은 말("가구")로 먼저 잡아채면, 있는 지표(1인가구 비율)를 두고 다른 지표
     * (세대수)로 답하게 된다. 비켜 주기만 하면 아래 공공 파싱이 제 일을 한다.
     */
    const publicFirst = prefersPublicTool(trimmed);

    // 두 지표의 변화를 겹쳐 묻는 질의를 먼저 본다. 지표가 둘이라 단일 추세보다 구체적이다.
    const trendCross = publicFirst ? null : resolveTrendCrossQuery(trimmed, /격자|블록/.test(trimmed)
      ? CROSS_LAYERS.filter((layer) => layer.id.startsWith("kcb-grid"))
      : CROSS_LAYERS, {
      adminLevelFallback: fallbackAdminLevel,
      dongNames: dongNamesForQuery,
    });
    if (trendCross) {
      rememberQuery(trimmed);
      if (runTrendCross(trendCross)) {
        setAnsweredLastQuery(true);
        return;
      }
      requestCubesAndRetry([trendCross.a.layerId, trendCross.b.layerId], {
        kind: "trendCross",
        match: trendCross,
      });
      setParseStage("analyze");
      setQueryNotice("민간데이터 레이어를 불러오는 중입니다.");
      setQueryNoticeTone("neutral");
      return;
    }

    // 추세 질의("카드매출 늘어나는 동")를 먼저 본다. 값의 크기가 아니라 변화를 묻는
    // 표현이므로 단일 시점 라우팅으로 넘기면 "많은 곳"과 구별되지 않는다.
    const trendMatch = publicFirst ? null : resolveTrendQuery(trimmed, PRIVATE_NL_LAYERS, {
      adminLevelFallback: fallbackAdminLevel,
    });
    if (trendMatch) {
      rememberQuery(trimmed);
      if (runTrend(trendMatch)) { setAnsweredLastQuery(true); return; }
      // 큐브가 아직 없을 뿐이다. 받아 와서 그대로 이어 실행한다.
      requestCubesAndRetry([trendMatch.layerId], { kind: "trend", match: trendMatch });
      setParseStage("analyze");
      setQueryNotice("민간데이터 레이어를 불러오는 중입니다.");
      setQueryNoticeTone("neutral");
      return;
    }

    // 민간×공공 교차분석: "생활인구 대비 카드매출", "소득과 소비 모두 높은 동" 등 두 지표를
    // z-표준화해 합성 순위로 보여준다(툴 결과처럼 customAnalysis 경로로 렌더).
    /*
     * 격자를 물었으면 교차 후보도 격자로 좁힌다.
     *
     * 격자 코드는 "gx_gy"라 행정동 코드와 겹치는 지역이 하나도 없다. 섞어서 교차하면
     * "0개 격자"가 나온다(prod 실측). "격자 소득 높고 소비도 많은 블록"에서 사용자가
     * 원한 것은 격자끼리 겹쳐 보는 것이다.
     */
    const wantsGrid = /격자|블록/.test(trimmed);
    const crossLayers = wantsGrid
      ? CROSS_LAYERS.filter((layer) => layer.id.startsWith("kcb-grid"))
      : CROSS_LAYERS;
    /*
     * 지표가 셋 이상이면 다중조건이 먼저다. 2지표 교차보다 뒤에 두면 앞의 두 개만 잡고
     * 나머지를 조용히 버린다 — 물어본 것보다 적게 답하면서 그 사실을 말하지 않게 된다.
     */
    const multi = publicFirst
      ? null
      : resolveMultiQuery(trimmed, crossLayers, { adminLevelFallback: fallbackAdminLevel });
    if (multi) {
      rememberQuery(trimmed);
      if (runMulti(multi)) { setAnsweredLastQuery(true); return; }

      requestCubesAndRetry(
        multi.operands.map((operand) => operand.layerId),
        { kind: "multi", match: multi },
      );
      setParseStage("analyze");
      setQueryNotice("민간데이터 레이어를 불러오는 중입니다.");
      setQueryNoticeTone("neutral");
      return;
    }

    /*
     * 통계 질의는 교차분석보다 **먼저** 갈라야 한다. 재료(지표 둘)가 같아서 교차가
     * 먼저 잡으면 "둘이 같이 움직이나"를 물은 사람이 "둘 다 높은 곳" 순위표를 받는다.
     */
    const stats = publicFirst
      ? null
      : resolveStatsQuery(trimmed, crossLayers, {
          adminLevelFallback: fallbackAdminLevel,
          dongNames: dongNamesForQuery,
        });
    if (stats) {
      rememberQuery(trimmed);
      if (runStats(stats, trimmed)) { setAnsweredLastQuery(true); return; }

      requestCubesAndRetry(
        stats.kind === "correlation" ? [stats.a.layerId, stats.b.layerId] : [stats.ref.layerId],
        { kind: "stats", match: stats, query: trimmed },
      );
      setParseStage("analyze");
      setQueryNotice("레이어를 불러오는 중입니다.");
      setQueryNoticeTone("neutral");
      return;
    }

    const cross = publicFirst
      ? null
      : resolveCrossQuery(trimmed, crossLayers, { adminLevelFallback: fallbackAdminLevel });
    if (cross) {
      rememberQuery(trimmed);
      if (runCross(cross)) { setAnsweredLastQuery(true); return; }

      // 교차 질의로 해석은 됐는데 큐브가 아직 없다. 단일 레이어 경로로 조용히 흘리지 말고,
      // 필요한 두 큐브를 받아 와서 그대로 이어 실행한다.
      requestCubesAndRetry([cross.a.layerId, cross.b.layerId], { kind: "cross", match: cross });
      setParseStage("analyze");
      setQueryNotice("민간데이터 레이어를 불러오는 중입니다.");
      setQueryNoticeTone("neutral");
      return;
    }

    // Private-data (SKT/NH/KCB) natural-language routing: if the query names a private
    // layer metric ("생활인구", "유동인구", …), switch the active choropleth layer instead
    // of falling through to the public tool-registry (which would misroute "생활인구" to the
    // public 인구 ranking because "생활인구" contains "인구"). Synchronous, no network.
    const layerMatch = publicFirst ? null : resolveLayerQuery(trimmed, PRIVATE_NL_LAYERS, {
      adminLevelFallback: fallbackAdminLevel,
      // 행정동 이름을 넘겨 "물금읍 생활인구"처럼 동을 지정한 질의를 그 동으로 좁힌다.
      dongNames: dongNamesForQuery,
    });
    /*
     * 민간 레이어 전환을 실제로 적용한다. 규칙이 바로 잡은 질의와, 규칙이 놓쳐 AI가
     * 지표를 지목해 준 질의가 같은 자리를 쓴다 — 두 벌로 두면 한쪽만 고쳐진다.
     */
    const applyLayerMatch = (match: LayerQueryMatch, prefix = "") => {
      setActiveLayerId(match.layerId as LayerId);
      setActiveMetricKey(match.metricKey);
      setLayerDirection(match.direction);
      setLayerRegionFilters(match.regionFilters);
      setAnsweredLastQuery(true);
      if (match.adminLevel !== adminLevel) setAdminLevel(match.adminLevel);
      adminLevelSourceRef.current = "query";
      setActiveTab("control");
      setParseStage("done");
      setQueryNotice(
        `${prefix}${match.layerLabel} · ${match.metricLabel} 레이어로 전환했습니다 (출처: ${providerSourceLabel(match.provider)}, ${match.regionFilters.length ? `${match.regionFilters.join("·")} 안 ` : ""}${match.geometry === "grid" ? "500m 격자" : match.adminLevel === "sgg" ? "시군구" : "행정동"} 단위${match.direction === "asc" ? " · 낮은 순" : ""}).`,
      );
      setQueryNoticeTone("success");
      setQuerySuggestions([]);
      rememberQuery(trimmed);
      window.setTimeout(() => setParseStage("idle"), 1200);
    };

    if (layerMatch) {
      applyLayerMatch(layerMatch);
      return;
    }

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
        metricHint?: { layerId: string; metricKey: string; metricLabel: string };
      };

      /*
       * 규칙이 지표 낱말을 못 알아본 질의를 AI가 지표로 지목해 준 경우. 질의에 그 지표의
       * 정식 이름을 붙여 민간 리졸버를 한 번 더 돌린다 — 지역·방향·단위·개수 판정은
       * 이미 그 안에 있으므로 다시 만들지 않는다. 지목이 카탈로그에 없는 지표면
       * 서버가 이미 걸러냈고, 여기서도 리졸버가 못 잡으면 평소 안내로 내려간다.
       */
      if (!data.intent?.tool && data.metricHint) {
        const hinted = resolveLayerQuery(
          `${trimmed} ${data.metricHint.metricLabel}`,
          PRIVATE_NL_LAYERS,
          { adminLevelFallback: fallbackAdminLevel, dongNames: dongNamesForQuery },
        );
        if (hinted && hinted.layerId === data.metricHint.layerId) {
          applyLayerMatch(hinted, "질문을 지표로 옮겨 읽었습니다 — ");
          return;
        }
      }

      if (!response.ok || !data.intent?.tool) {
        setParseStage("idle");
        setQueryNotice(
          data.notice ??
            "이 질문으로는 바로 분석하기 어렵습니다. 예시 질문을 눌러 보세요.",
        );
        setQueryNoticeTone("error");
        setAnsweredLastQuery(false);
        /*
         * 오타 한 글자 때문에 못 찾은 것일 수 있다("카드매츨"). 자동으로 고쳐 답하지는
         * 않는다 — "소비"와 "소득"은 한 글자 차이지만 전혀 다른 지표다. 대신 가까운 지표를
         * 그대로 쓸 수 있는 문장으로 제안하고, 고르는 것은 사람이 한다.
         */
        const near = suggestMetrics(trimmed, CROSS_LAYERS);
        if (near.length > 0) {
          setQueryNotice(
            `찾는 지표를 알아보지 못했습니다. 혹시 ${near.map((item) => `「${item.metricLabel}」`).join(" · ")}인가요?`,
          );
          setQuerySuggestions(near.map((item) => item.example));
        } else {
          setQuerySuggestions(data.suggestions?.length ? data.suggestions : [...QUERY_SUGGESTIONS]);
        }
        rememberQuery(trimmed);
        return;
      }
      rememberQuery(trimmed);
      if (!snapshot) return;

      setAnsweredLastQuery(true);
      setParseStage("analyze");
      setQueryNotice("분석 실행 중…");

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
      setActiveLayerId("medical");
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

  /*
   * 공유 링크 복원이 부르는 최신 runQueryText를 담아 둔다. 이 함수는 매 렌더마다 새로
   * 만들어지는데, 복원 effect가 그것을 의존성으로 잡으면 매 렌더마다 다시 돈다.
   *
   * 대입은 커밋된 뒤에 한다 — 렌더 중에 하면 버려진 렌더의 함수가 남을 수 있다.
   * 복원은 스냅샷이 도착한 뒤(비동기)라 시점 문제는 없다.
   */
  useEffect(() => {
    runQueryTextRef.current = runQueryText;
  });

  /*
   * 공유 링크의 질문을 스냅샷이 도착한 뒤 한 번 실행한다.
   *
   * 이 effect는 위의 ref 대입 **뒤에** 선언해야 한다 — 같은 커밋 안에서 effect는 선언 순서로
   * 돌기 때문에, 앞에 두면 스냅샷을 못 보는 옛 클로저를 다시 부르게 된다.
   */
  useEffect(() => {
    if (!pendingShareQuery || !snapshot || shareQueryRunRef.current) return;
    shareQueryRunRef.current = true;
    void runQueryTextRef.current?.(pendingShareQuery);
  }, [pendingShareQuery, snapshot]);

  const submitQuery = async (event: FormEvent) => {
    event.preventDefault();
    await runQueryText(query);
    /*
     * 좁은 화면에서는 답이 결과 시트 안에 있는데, 물어 놓고 시트를 따로 열어야 했다.
     * 질의창이 시트 위 히어로로 올라간 뒤로는 시트를 열어도 다음 질문을 막지 않으므로
     * 바로 보여 준다.
     */
    if (isNarrowNow()) setSheetMode("right");
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
    /*
     * 로딩 화면에도 상단 바를 둔다.
     *
     * 이 화면이 뜨는 동안(실측 1.4초) 예전에는 회색 상자 하나뿐이었다 — 어느 도구에
     * 들어왔는지도 알 수 없었다. 상단 바는 스냅샷 없이도 그릴 수 있으므로 기다릴 이유가
     * 없다. 다만 h1이 여기서도 보이게 되었으므로 **h1은 더 이상 "앱이 준비됐다"는
     * 신호가 아니다** — e2e는 `data-testid="copilot-shell"`을 기다린다.
     */
    return (
      <div className="copilot-boot">
        <AppTopbar snapshot={null} />
        <main
          className="grid flex-1 place-items-center bg-[var(--surface-0,#e7edf3)] p-6"
          aria-busy="true"
          data-testid="copilot-boot"
        >
          <div className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-[var(--surface-2,#fff)] p-6 shadow-lg">
            <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-slate-200" />
            <div className="mb-2 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200" />
            <p className="mt-5 text-center text-sm font-medium text-slate-600">경남 공간 데이터를 준비하는 중…</p>
          </div>
        </main>
      </div>
    );
  }

  // 교차분석은 activeLayerId를 medical로 두고 customAnalysis로 렌더하므로, 방법론·기준월이
  // 의료 레이어 값으로 새지 않도록 교차 결과 자체의 산식을 쓴다.
  const isCrossView = analysis?.id === "cross";
  /*
   * 공공 도구 결과는 `activeLayerId`가 "medical"인 채로 렌더된다. 그래서 이 자리가
   * 무엇을 물어도 의료취약지수 공식만 보여 주고 있었다 — "세대수 많은 동"을 물었는데
   * 화면 아래에 "공급 부족 35% + 고령 수요 25% …"가 붙어 나왔다(prod 실측).
   *
   * 도구마다 이미 제 산식을 `formulaNotes`로 낸다. 그것을 쓰면 된다. 단 **시설 검색은
   * 제외한다** — 그 산식은 "약국을 제외한 모든 의료기관"처럼 목록을 거르는 규칙이라,
   * 지도에 그려진 지표(의료취약지수)와 무관하다. METHOD_SUMMARY는 그럴 때의 기본값이다.
   */
  const methodSummaryText = isCrossView
    ? analysis.formulaNotes.join(" · ")
    : activeLayerId !== "medical" && activeMetric
      ? `${activeMetric.label} = ${activeMetric.formula}${
          activeMetric.limitation ? ` · ${activeMetric.limitation}` : ""
        }`
      : analysis && !analysis.isFacilityResult && analysis.formulaNotes.length > 0
        ? analysis.formulaNotes.join(" · ")
        : METHOD_SUMMARY;
  const referenceMonthLabel =
    activeLayerId !== "medical" && activeCube ? activeCube.referenceMonth : snapshot.referenceMonth;
  const activeLayerLabel =
    LAYER_OPTIONS.find((layer) => layer.id === activeLayerId)?.label ?? activeLayerId;
  const activeMetricLabel =
    activeLayerId === "medical" ? "지점 목록" : (activeMetric?.label ?? "지표");
  const activeUnitLabel = unitWordOf(activeLayerId, adminLevel);
  const pickerSummary = `${activeLayerLabel} · ${activeMetricLabel} · ${activeUnitLabel}`;
  const mapViewLabel = `${pickerSummary} · ${referenceMonthLabel}`;

  const latestIndex = snapshot.months.length - 1;
  const currentPopulation = selectedRegion?.population[latestIndex] ?? 0;
  const currentElderly = selectedRegion?.elderlyPopulation[latestIndex] ?? 0;
  const currentNaturalChange = selectedRegion?.naturalChange[latestIndex] ?? 0;
  const currentOnePerson = selectedRegion?.onePersonHouseholds[latestIndex] ?? null;
  const currentRank = analysis.ranked.findIndex((row) => row.code === selectedRegionCode) + 1;
  const emptyResult =
    !isLayerCubeLoading &&
    (analysis.isFacilityResult
      ? analysis.filteredFacilities.length === 0
      : analysis.ranked.length === 0);

  const shellStyle = {
    ...cssVars,
    ["--sheet-height" as string]: `${sheetHeight}dvh`,
  };

  return (
    <main className="copilot-shell" style={shellStyle} data-sheet={sheetMode} data-testid="copilot-shell">
      <a href="#left-panel" className="skip-link">
        분석 조작 패널로 건너뛰기
      </a>

      {/*
        제품 정체성과 데이터 기준월은 늘 보여야 한다. 이전엔 왼쪽 패널 안에 있었는데,
        그 패널이 기본으로 접히면서 h1이 `aria-hidden` 아래로 들어가 접근성 트리에서
        사라졌다 — 스크린리더에게는 제목 없는 페이지가 됐고, e2e 14건이 전부
        "heading not found"로 떨어졌다. 어느 패널에도 두지 않는다.

        로딩 화면도 같은 컴포넌트를 쓴다(app-topbar.tsx). 따로 적으면 갈라진다.
      */}
      <AppTopbar
        snapshot={snapshot}
        onOpenTab={(id) => {
          setActiveTab(id);
          if (isNarrowNow()) setSheetMode("left");
          else if (layout.leftCollapsed) toggleLeft();
        }}
      />

      {/* LEFT: controls only */}
      <aside
        id="left-panel"
        className={`copilot-panel copilot-panel-left ${sheetMode === "left" ? "sheet-open" : ""} ${
          layout.leftCollapsed ? "is-collapsed" : ""
        }`}
        aria-label="분석 조작 패널"
        /*
          접근성 트리에서 빼는 기준은 "정말 안 보이는가"다. 좁은 화면에서는 시트가 열려
          있으면 보이는 것이므로, 접힘 상태(leftCollapsed)만 보고 숨기면 시트를 열어도
          내용이 스크린리더에 없다 — e2e에서 시트를 열고도 '이용' 탭을 못 찾았다.
        */
        aria-hidden={(sheetMode === "left" ? false : layout.leftCollapsed) || undefined}
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
        {/* 제품 헤더는 상단 바(copilot-topbar)로 올렸다. 여기서는 탭부터 시작한다. */}
        <nav className="px-3 pt-3" aria-label="왼쪽 패널 탭">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1" role="tablist">
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
              <section className="picker-block" data-testid="analysis-picker">
                <button
                  type="button"
                  className="picker-summary"
                  aria-expanded={pickerOpen}
                  data-testid="picker-summary"
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  <span className="picker-summary-label">{pickerSummary}</span>
                  <span className="picker-summary-hint">{pickerOpen ? "접기" : "고르기"}</span>
                </button>
                {pickerOpen ? (
                  <>
                    <p className="picker-intro" data-testid="analysis-intro">
                      {LAYER_OPTIONS.length}개 자료를 지도에 겹쳐 보고, 질문으로 순위를 냅니다
                    </p>
              <div>
                <h2 className="section-label">레이어 직접 고르기</h2>
                <p className="ui-caption mb-2 -mt-1">
                  질문으로 안 될 때 손으로 고릅니다 · {LAYER_OPTIONS.length}개
                </p>
                <LayerSwitcher
                  layers={LAYER_OPTIONS}
                  activeId={activeLayerId}
                  onChange={(id) => {
                    const nextId = id as LayerId;
                    setActiveLayerId(nextId);
                    // 앞 질의에서 "낮은 순"이었으면 레이어만 바꿨을 때도 그대로 남는다.
                    // 버튼으로 고른 것은 방향 요구가 없으므로 기본(높은 순)으로 되돌린다.
                    setLayerDirection("desc");
                    setLayerRegionFilters([]);
                    if (nextId !== "medical") {
                      selectMetric(CUBE_LAYER_METRICS[nextId][0]);
                    }
                    // 교차분석은 activeLayerId를 medical로 둔 채 customAnalysis로 렌더한다.
                    // 이걸 비우지 않으면 의료 레이어를 눌러도(이미 medical이라 상태가 그대로여서)
                    // 교차 결과가 화면에 남아 레이어를 바꿔도 아무 반응이 없는 것처럼 보인다.
                    setCustomAnalysis(null);
                  }}
                  activeSlot={
                      <div className="metric-picker" data-testid="metric-picker">
                        {activeLayerId === "medical" ? (
                          <p className="ui-caption metric-picker-note">
                            이 레이어는 지점 목록이라 고를 지표가 없습니다
                          </p>
                        ) : (
                          <>
                            <p className="ui-caption metric-picker-head">
                              지표 · {activeLayerMetrics.length}개
                            </p>
                            <div role="group" aria-label="지표 선택" className="metric-chips">
                              {activeLayerMetrics.map((metric) => (
                                <button
                                  key={metric.key}
                                  type="button"
                                  className="metric-chip"
                                  aria-pressed={metric.key === activeMetricKey}
                                  onClick={() => {
                                    selectMetric(metric);
                                    setPickerOpen(false);
                                  }}
                                >
                                  {metric.label}
                                  {metric.unit ? (
                                    <span className="metric-chip-unit">{metric.unit}</span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <AdminLevelToggle
                            value={adminLevel}
                            onChange={(level) => {
                              // 사용자가 직접 고른 단위는 다음 질의까지 이어진다.
                              adminLevelSourceRef.current = "user";
                              setAdminLevel(level);
                            }}
                          />
                          {activeMetric?.scope === "sgg" ? (
                            <span className="ui-caption metric-picker-note">
                              원자료가 시군구까지만 제공되는 지표입니다
                            </span>
                          ) : null}
                        </div>
                      </div>
                  }
                />
                {activeLayerError ? (
                  <p className="mt-2 ui-caption text-rose-600">{activeLayerError}</p>
                ) : null}
              </div>

              {/*
                질의창은 이 패널에 없다. 지도 위 히어로(QueryHero)로 올렸다 — 주기능이
                레이어 버튼 아래에 묻혀 있었고, 모바일에서는 결과 시트에 덮여 아예 닿지
                않았다. 이 패널은 이제 "직접 고르기"만 맡는다.
              */}
              {activeLayerId === "medical" ? (
                <section>
                  {/*
                    여덟 개 중 넷이 의료다. 공공 스냅샷(인구·의료기관)으로 도는 것들이라
                    그런 것인데, 아무 말이 없으면 이 도구가 의료 도구로 읽힌다.
                    무엇으로 도는지와 나머지는 어디 있는지를 함께 적는다.
                  */}
                  <h2 className="section-label">빠른 분석</h2>
                  <p className="ui-caption mb-2 -mt-1">
                    공공 데이터(인구·의료기관)로 바로 도는 분석입니다. 민간 데이터는 질문으로
                    묻거나 위에서 레이어를 고르세요.
                  </p>
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
              ) : null}

              <section data-testid="trend-presets">
                <h2 className="section-label">추세 분석</h2>
                <p className="ui-caption mb-2 -mt-1">
                  기준월 값이 아니라 전 기간 변화율 순
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {TREND_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`trend-${preset.id}`}
                      aria-label={preset.label}
                      onClick={() => runTrendPreset(preset.query)}
                      className="quick-tile min-h-[56px] rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-slate-300 active:scale-[.98]"
                    >
                      <span className="block ui-body font-bold text-slate-900">{preset.label}</span>
                      <span className="ui-caption mt-0.5 block text-slate-500">{preset.subtitle}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section data-testid="cross-presets">
                <h2 className="section-label">민간데이터 교차분석</h2>
                <p className="ui-caption mb-2 -mt-1">
                  두 지표를 z-표준화해 비교 (SKT·NH·KCB × 공공)
                </p>
                <div className="space-y-2.5">
                  {CROSS_PRESET_GROUPS.map((group) => {
                    const items = CROSS_PRESETS.filter((preset) => preset.group === group);
                    if (items.length === 0) return null;
                    return (
                      <div key={group}>
                        <p className="ui-caption mb-1 font-bold text-slate-500">{group}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {items.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              data-testid={`cross-${preset.id}`}
                              aria-label={preset.label}
                              onClick={() => runCrossPreset(preset.query)}
                              className="quick-tile min-h-[56px] rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-slate-300 active:scale-[.98]"
                            >
                              <span className="block ui-body font-bold text-slate-900">{preset.label}</span>
                              <span className="ui-caption mt-0.5 block text-slate-500">{preset.subtitle}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
                  </>
                ) : null}
              </section>

              {activeLayerId === "medical" && (activeQuick === "compare" || lastIntent?.tool === "compareRegions") && (
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
                          ["창원시", "김해시"],
                          ["진주시", "양산시"],
                          ["통영시", "거제시"],
                          ["사천시", "밀양시"],
                          ["거창군", "합천군"],
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

              {activeLayerId === "medical" ? (
                <section>
                  <h2 className="section-label">접근 반경</h2>
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
              ) : null}

              {activeLayerId === "medical" && selectedRegion && lastIntent ? (
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
              {/*
                활용 가이드.

                여기 있던 세 줄(질문 → 지도 → 오른쪽)은 화면의 생김새만 말하고 **무엇을 할 수
                있는지**는 말하지 않았다. 그래서 대부분 빠른 분석만 누르고 지점 분석·교차·추세·
                내보내기는 있는 줄도 모르는 채 남았다. 각 단계에 「무엇을·어떻게·틀리기 쉬운
                자리」를 함께 적는다.
              */}
              <section
                className="rounded-xl border border-slate-200 bg-white p-3.5"
                data-testid="usage-guide"
              >
                <p className="ui-title text-slate-900">활용 가이드</p>
                <p className="ui-caption mt-1 text-slate-500">
                  무엇을 할 수 있고, 어디서 어떻게 하는지
                </p>
                <ol className="mt-2.5 space-y-2">
                  {USAGE_GUIDE.map((step) => (
                    <li key={step.order}>
                      <details className="rounded-lg border border-slate-100 bg-slate-50/60">
                        <summary className="cursor-pointer px-3 py-2 ui-body font-bold text-slate-800">
                          <span className="text-slate-400">{step.order}.</span> {step.title}
                        </summary>
                        <div className="border-t border-slate-100 px-3 py-2.5">
                          <p className="ui-body text-slate-700">{step.what}</p>
                          <ul className="mt-1.5 list-disc space-y-1 pl-4 ui-body text-slate-600">
                            {step.how.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                          {step.caution ? (
                            <p className="ui-caption mt-1.5 text-amber-700">⚠ {step.caution}</p>
                          ) : null}
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              </section>

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
                <a
                  href="/evaluator"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex ui-body font-bold text-blue-800 underline-offset-2 hover:underline"
                  data-testid="evaluator-print-link"
                >
                  평가 인쇄 1페이지 열기 →
                </a>
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
                  <li>지역 비교 결과 → 「동 순위 보기」로 한 단계 더</li>
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
                      <span className="kbd">j</span>/<span className="kbd">k</span> 순위 이동 (대안)
                    </li>
                  </ul>
                </details>
              </div>

              {/*
                용어집을 화면에 둔다. 「의료취약지수 78점」이 무엇인지 물어볼 데가 없으면
                그 값은 보고서에 그대로 옮겨지고, 옮긴 사람이 설명하지 못한다. 뜻만 적지 않고
                **틀리기 쉬운 자리**를 함께 적는다 — 생활인구를 주민등록인구로 읽는 것처럼,
                뜻을 알고도 잘못 읽는 자리가 따로 있다.
              */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5" data-testid="glossary">
                <p className="ui-body font-bold text-slate-900">용어</p>
                <p className="ui-caption mt-1 text-slate-500">
                  이 도구가 쓰는 말의 뜻과, 틀리기 쉬운 자리
                </p>
                {GLOSSARY_GROUPS.map((group) => (
                  <details key={group} className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/60">
                    <summary className="cursor-pointer px-3 py-2 ui-chip font-bold text-slate-700">
                      {group}
                    </summary>
                    <ul className="space-y-2.5 border-t border-slate-100 px-3 py-2.5">
                      {GLOSSARY.filter((entry) => entry.group === group).map((entry) => (
                        <li key={entry.term}>
                          <p className="ui-body font-bold text-slate-900">{entry.term}</p>
                          <p className="ui-body text-slate-600">{entry.meaning}</p>
                          {entry.caution ? (
                            <p className="ui-caption mt-0.5 text-amber-700">⚠ {entry.caution}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
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
                {/*
                  "실데이터 스냅샷"이라는 한 문장이 인구 통계의 출처를 규정한다. mode가 live여도
                  갱신된 것은 시설뿐이고 인구·세대는 기준 스냅샷(합성값)인 상태가 실제로 있었다
                  (prod 실측). 그 상태를 "실데이터"라고 부르면 합성값이 보고서에 실린다.
                */}
                <p className="ui-body font-bold">
                  {snapshot.mode !== "live"
                    ? "지금 시연용 데이터를 보고 있습니다"
                    : populationIsLive(snapshot.mode, snapshot.sourceNotes)
                      ? "지금 실데이터 스냅샷을 보고 있습니다"
                      : "시설만 실데이터입니다 — 인구·세대는 기준 스냅샷입니다"}
                </p>
                <p className="ui-body mt-1.5 opacity-90">
                  {snapshot.mode !== "live"
                    ? "시연 합성 데이터입니다. 정책 판단·대외 수치 인용에 사용하지 마세요. 실데이터는 동기화 후 live 스냅샷으로 전환됩니다."
                    : populationIsLive(snapshot.mode, snapshot.sourceNotes)
                      ? "기준월과 출처 노트를 함께 확인하세요. 시설·인구 원천이 다를 수 있습니다."
                      : "의료기관은 HIRA 실데이터입니다. 인구·세대·출생·사망은 합성값이라 대외 수치로 인용하지 마세요."}
                </p>
                <p className="ui-caption mt-2 font-semibold opacity-95">
                  범위: 경상남도 · 산식: 공급35+고령25+거리25+2km무시설15
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
                  ["시설", `${snapshot.facilities.length.toLocaleString("ko-KR")}곳`],
                  ["지도", mapEngineLabel(kakaoMapKey, mapEngine)],
                  ["의료기관 자료", "건강보험심사평가원"],
                  ["지도 시설 상한", `${MAP_FACILITY_CAP.toLocaleString("ko-KR")}곳`],
                ].map(([label, value]) => (
                  <div key={label} className="ui-stat-card">
                    <p className="label">{label}</p>
                    <p className="value">{value}</p>
                  </div>
                ))}
              </div>

              {/*
                활용 데이터 목록.

                손으로 적으면 카탈로그와 갈라진다 — 지표를 더하고 목록을 안 고치면 화면에는
                있는데 목록에는 없는 지표가 생긴다. 그래서 정본에서 만든다
                (@/lib/analysis/data-inventory). 산식과 한계를 지표마다 함께 적는 이유는,
                이 값이 공공기관 보고서로 옮겨지기 때문이다.
              */}
              <section
                className="rounded-xl border border-slate-200 bg-white p-3.5"
                data-testid="data-inventory"
              >
                <p className="ui-title text-slate-900">활용 데이터</p>
                <p className="ui-caption mt-1 text-slate-500">
                  제공기관 {DATA_INVENTORY.length}곳 · 레이어 {INVENTORY_TOTALS.layers}개 · 지표{" "}
                  {INVENTORY_TOTALS.metrics}개
                </p>
                {DATA_INVENTORY.map((group) => (
                  <details
                    key={group.provider}
                    className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/60"
                  >
                    <summary className="cursor-pointer px-3 py-2 ui-body font-bold text-slate-800">
                      {group.provider}{" "}
                      <span className="ui-caption font-semibold text-slate-500">
                        레이어 {group.layers.length} · 지표 {group.metricCount}
                      </span>
                    </summary>
                    <div className="border-t border-slate-100 px-3 py-2.5">
                      <p className="ui-caption text-slate-600">{group.note}</p>
                      {group.layers.map((layer) => (
                        <div key={layer.id} className="mt-2.5">
                          <p className="ui-body font-bold text-slate-900">
                            {layer.label}{" "}
                            <span className="ui-caption font-semibold text-slate-500">
                              {layer.unitLabel}
                            </span>
                          </p>
                          <ul className="mt-1 space-y-1">
                            {layer.metrics.map((metric) => (
                              <li key={metric.label} className="ui-caption text-slate-600">
                                <span className="font-bold text-slate-800">{metric.label}</span>
                                {metric.unit ? ` (${metric.unit})` : ""} · {metric.formula}
                                {metric.sggOnly ? (
                                  <span className="ml-1 font-bold text-amber-700">시군구만</span>
                                ) : null}
                                {metric.limitation ? (
                                  <span className="block text-amber-700">⚠ {metric.limitation}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                          {layer.sourceNotes.map((note) => (
                            <p key={note} className="ui-caption mt-0.5 text-slate-500">
                              출처 · {note}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </section>

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
                      : "border-emerald-200 bg-emerald-50 text-emerald-950"
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
                  {publishedLive?.available ? (
                    <p className="ui-chip mt-1 font-semibold text-emerald-800">
                      게시 live{" "}
                      {publishedLive.facilityCount != null
                        ? `${publishedLive.facilityCount.toLocaleString("ko-KR")}곳`
                        : ""}
                      {publishedLive.createdAt
                        ? ` · ${new Date(publishedLive.createdAt).toLocaleString("ko-KR")}`
                        : ""}
                    </p>
                  ) : (
                    <p className="ui-chip mt-1 text-amber-800">
                      게시된 live 스냅샷 없음 · POST /api/data/sync 필요
                    </p>
                  )}
                  {/* 갱신 권장 사유는 운영자용이다. 첫 화면 토스트에서 여기로 옮겼다. */}
                  {syncOps.reason ? (
                    <p className="ui-chip mt-1 text-slate-600" data-testid="sync-ops-reason">
                      {syncOps.reason}
                    </p>
                  ) : null}
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
                  <p className="ui-chip mt-2 text-slate-500">
                    상세: /api/data/sync · 연결 상태: /api/health
                  </p>
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
                          ["AI 질문 해석", capabilities.ai],
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
                    <div className="ui-chip space-y-1 text-slate-600" data-testid="ai-status">
                      {capabilities.ai ? null : (
                        <p>{aiIssueLabel(aiIssue) ?? "AI 질문 해석이 꺼져 있습니다."}</p>
                      )}
                      <p>{aiOutcomeLabel(aiLastOutcome)}</p>
                    </div>
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
          boundary={activeLayerId === KCB_GRID_LAYER.id && gridBoundary ? gridBoundary : boundary}
          regions={snapshot.regions}
          facilities={mapFacilities}
          livePlaces={livePlaces}
          scores={scores}
          selectedRegionCode={selectedRegionCode}
          focusRegionCodes={focusRegionCodes}
          radiusKm={radiusKm}
          showFacilities={analysis.isFacilityResult}
          followSelection={followSelection}
          /*
           * 반경 원은 "2km 안에 의료시설이 있는가"를 묻는 분석의 표시다. 생활인구·소비
           * 순위에도 늘 겹쳐 그려서, 뜻 없는 파란 원이 지도를 덮고 있었다.
           */
          showRadius={activeLayerId === "medical" && !customAnalysis}
          probeMode={probeMode}
          probePoint={probePoint}
          probeRadiusKm={probeRadiusKm}
          onProbePoint={setProbePoint}
          legendLabel={analysis.legendLabel}
          viewLabel={mapViewLabel}
          onSelectRegion={selectRegion}
          onSelectFacility={selectFacility}
          onSelectLivePlace={selectLivePlace}
          onEngineChange={setMapEngine}
        />

        <QueryHero
          query={query}
          onQueryChange={setQuery}
          onSubmit={submitQuery}
          inputRef={queryInputRef}
          isParsing={isParsing}
          parseStage={parseStage}
          notice={queryNotice}
          noticeTone={queryNoticeTone}
          caveat={queryCaveat}
          suggestions={querySuggestions}
          onPickSuggestion={(value) => {
            setQuery(value);
            setQuerySuggestions([]);
            queryInputRef.current?.focus();
          }}
          examples={QUERY_SUGGESTIONS}
          recentQueries={recentQueries}
          onClearRecent={clearRecentQueries}
        />

        {/*
          무엇을 보고 있는지 알려 주는 배지. 히어로가 상단 가운데를 쓰므로 왼쪽 아래로
          내렸다. 지도 조작을 가리지 않도록 pointer-events는 없다.
        */}
        <div className="map-context-badge">
          {mapFacilitiesCapped ? (
            <p className="ui-caption mb-1 font-semibold text-amber-700">
              지도 시설 {MAP_FACILITY_CAP}개 표시 · 전체 {typedMapFacilities.length.toLocaleString("ko-KR")}
            </p>
          ) : null}
          <p className="ui-caption font-bold text-blue-600">{analysis.title}</p>
          {/*
            지도가 비추는 곳을 말해야 한다. 사용자가 직접 고르기 전까지 지도는 경남 전역을
            비추는데, 앞 분석에서 남은 선택 지역 이름을 여기 띄우면 "생활인구 1위는 양산시
            물금읍"이라는 결론 옆에 엉뚱하게 거창군 북상면이 적힌다.
          */}
          <p className="max-w-[260px] truncate ui-body font-bold text-slate-900">
            {followSelection && selectedRegion ? compactName(selectedRegion) : "경상남도 전역"}
          </p>
          {isCompareView && focusRegionCodes ? (
            <p className="ui-caption mt-1 font-bold text-amber-800">
              비교 강조 · {comparePair[0]} · {comparePair[1]}
            </p>
          ) : null}
        </div>

        {probe ? (
          <PointProbeCard
            probe={probe}
            radiusKm={probeRadiusKm}
            onRadiusChange={setProbeRadiusKm}
            onClose={() => {
              setProbePoint(null);
              setProbeMode(false);
            }}
          />
        ) : probeMode ? (
          <div className="probe-hint" data-testid="probe-hint">
            지도를 클릭하면 그 지점 반경 {probeRadiusKm}km를 읽습니다.
          </div>
        ) : null}

        <div className="map-float-dock absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 max-md:bottom-20">
          {/*
            레이아웃 프리셋 5개(지도 넓게·분석 넓게·결과 넓게·균형·레이아웃)가 지도의 알짜
            공간을 두 줄로 차지하고 있었다. 패널을 여닫는 일은 조작·결과 두 버튼과 가장자리
            토글로 충분하다. 프리셋은 왼쪽 패널 '화면 설정'과 단축키에 남아 있다.
          */}
          <div className="map-float-bar">
            <button
              type="button"
              className="mobile-panel-btn !m-0 !shadow-none"
              /*
                좁은 화면에서는 leftCollapsed가 늘 참(기본값)이라 sheetMode만 남고,
                넓은 화면에서는 sheetMode가 늘 "none"이라 접힘 상태만 남는다. 한 식으로
                두 모델을 다 읽는다.
              */
              aria-pressed={sheetMode === "left" || !layout.leftCollapsed}
              onClick={toggleControls}
            >
              조작
            </button>
            <button
              type="button"
              className="mobile-panel-btn !m-0 !shadow-none"
              aria-pressed={sheetMode === "right" || !layout.rightCollapsed}
              onClick={toggleResults}
            >
              결과
            </button>
            {/*
              임시 지도(DemoMap)는 클릭 좌표를 주지 못한다. 버튼을 그려 두고 눌러도 아무 일이 없으면
              사용자는 자기가 잘못 누른 줄 안다 — 못 하는 자리에서는 버튼을 감춘다.

              경계가 아직 안 왔을 때도 마찬가지다. Kakao 지도는 떠 있지만 면이 하나도 안
              그려진 동안에는 지도 클릭이 올라오지 않는다 — 배포본에서 **6번 눌러 6번 다
              아무 일도 없었고**, 면이 그려진 뒤에는 6번 다 찍혔다(실측). 엔진만 보고
              내보내면 켜자마자 누른 사람에게는 이 기능이 고장 난 것으로 보인다.
            */}
            {mapEngine === "kakao" && boundary ? (
              <button
                type="button"
                className="mobile-panel-btn !m-0 !shadow-none"
                data-testid="probe-toggle"
                aria-pressed={probeMode}
                onClick={() => {
                  setProbeMode((on) => {
                    // 모드를 끄면 찍힌 지점도 지운다. 원만 남으면 무엇의 반경인지 모른다.
                    if (on) setProbePoint(null);
                    return !on;
                  });
                }}
              >
                지점 분석
              </button>
            ) : null}
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
            <p className="ui-caption font-bold">30초 시작</p>
            <h2 id="onboard-title" className="ui-title mt-1">
              이렇게 써 보세요
            </h2>
            <ol className="mt-3 space-y-2 ui-body">
              {/* 질의창이 지도 위 맨 위로 올라갔다. 어디를 보라는 말인지 맞춰 둔다. */}
              <li>
                <span className="font-bold">1.</span> 맨 위 질문창에 「생활인구 많은 동네」처럼 적습니다
              </li>
              <li>
                <span className="font-bold">2.</span> SKT·NH·KCB 민간데이터가 지도에 칠해집니다
              </li>
              <li>
                <span className="font-bold">3.</span> 결과 패널에서 순위·해석을 보고 보고서로 내보냅니다
              </li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="onboard-btn-primary px-3.5 py-2 ui-chip font-bold"
                onClick={runOnboardExample}
              >
                생활인구 보기
              </button>
              <button
                type="button"
                className="onboard-btn-ghost px-3.5 py-2 ui-chip font-bold"
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
        aria-hidden={(sheetMode === "right" ? false : layout.rightCollapsed) || undefined}
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
                지역 비교로
              </button>
              {drillTrail.map((token) => (
                <span key={token} className="text-slate-500">
                  › {token}
                </span>
              ))}
            </div>
          ) : null}
          <p className="ui-body mt-1.5 text-slate-600">{analysis.summary}</p>
          {!answeredLastQuery ? (
            <p
              className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 ui-body text-amber-900"
              data-testid="stale-answer-notice"
            >
              방금 질문에는 답하지 못했습니다. 아래는 직전 분석 결과입니다.
            </p>
          ) : null}
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
          {profileMissingForDistrict ? (
            <p className="ui-caption mt-2.5 text-slate-500" data-testid="region-profile-unavailable">
              민간데이터 종합은 행정동 단위로만 있습니다. 시군구로 합친 결과에서는 볼 수 없어, 행정동을
              고르면 나타납니다.
            </p>
          ) : null}
          {regionProfile && regionProfile.entries.length > 0 ? (
            <details className="mt-2.5 rounded-lg border border-slate-200 bg-white" data-testid="region-profile">
              <summary className="cursor-pointer px-2.5 py-2 ui-body font-bold text-slate-800">
                {regionProfile.name.replace(/^경상남도\s*/, "")} 민간데이터 종합 ({regionProfile.entries.length}개 지표)
              </summary>
              <div className="border-t border-slate-100 px-2.5 py-2">
                <p className="ui-caption mb-1.5 text-slate-500">
                  괄호 안은 경남 305개 행정동 대비 백분위(100=최상위) · ▲▼는 추세
                </p>
                <div className="mb-2 flex items-center gap-1" role="group" aria-label="추세 기간">
                  <span className="ui-caption text-slate-500">추세 기간</span>
                  {[
                    { months: 0, label: "전체" },
                    { months: 6, label: "6개월" },
                    { months: 3, label: "3개월" },
                  ].map((option) => (
                    <button
                      key={option.months}
                      type="button"
                      data-testid={`trend-months-${option.months}`}
                      aria-pressed={trendMonths === option.months}
                      onClick={() => setTrendMonths(option.months)}
                      className={`rounded-md border px-1.5 py-0.5 ui-caption font-semibold transition ${
                        trendMonths === option.months
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <ul className="space-y-1">
                  {regionProfile.entries.map((entry) => (
                    <li
                      key={`${entry.layerId}-${entry.metricKey}`}
                      className="flex items-baseline justify-between gap-2 ui-caption"
                    >
                      <span className="text-slate-600">
                        <span className="font-semibold text-slate-500">[{entry.provider}]</span>{" "}
                        {entry.metricLabel}
                      </span>
                      <span className="shrink-0 font-bold text-slate-900">
                        {entry.value === null
                          ? "데이터 없음"
                          : `${entry.value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${entry.unit}`}
                        {entry.percentile === null ? "" : ` (${Math.round(entry.percentile)})`}
                        {entry.trend.direction === "rising" ? (
                          <span className="ml-1 font-bold text-rose-600" title="증가 추세">
                            ▲
                          </span>
                        ) : entry.trend.direction === "falling" ? (
                          <span className="ml-1 font-bold text-blue-600" title="감소 추세">
                            ▼
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
          <p
            className="ui-caption mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-slate-600"
            data-testid="method-summary"
          >
            <span className="font-bold text-slate-800">방법론 · </span>
            {methodSummaryText}
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
            {" · "}기준월 {referenceMonthLabel}
            {" · "}{activeLayerProvider}
            {snapshot.mode === "demo" ? " · 정책 판단용 아님" : ""}
          </div>
          {/*
            읽을 것(몇 개인가·선택은 몇 위인가)과 할 것(내보내기)이 한 칩 구름에 섞여 있어
            무엇이 눌리는지 구분되지 않았다. 사실은 문장으로, 동작만 버튼으로 나눈다.
          */}
          <p className="ui-caption mt-2.5 text-slate-500" data-testid="result-meta">
            {analysis.isFacilityResult
              ? `${filteredFacilitiesList.length.toLocaleString("ko-KR")}개 시설`
              : `${filteredRanked.length.toLocaleString("ko-KR")}개 ${analysis.unitWord ?? unitWordOf(activeLayerId, adminLevel)}`}
            {currentRank > 0 ? ` · 선택 ${currentRank}위` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="내보내기">
            <button
              type="button"
              data-testid="export-csv"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={exportCurrentCsv}
            >
              CSV
            </button>
            <button
              type="button"
              data-testid="export-report"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={() => void exportCurrentReport()}
            >
              보고서
            </button>
            <button
              type="button"
              data-testid="export-hwp"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={() => void exportCurrentHwp()}
            >
              한글
            </button>
            <button
              type="button"
              data-testid="export-a4"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={exportCurrentA4}
              title="A4로 인쇄되거나 PDF로 저장되는 보고서 파일"
            >
              A4
            </button>
            <button
              type="button"
              data-testid="export-slides"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={exportCurrentSlides}
            >
              슬라이드
            </button>
            <button
              type="button"
              className="ui-chip rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:border-blue-300"
              onClick={() => {
                /*
                 * 민간 레이어·교차·추세 결과는 공공 도구가 아니라 lastIntent가 null이다.
                 * 여기서 의료 도구를 기본값으로 채워 넣으면 링크를 열었을 때 그 도구가
                 * 먼저 실행돼 원래 결과가 사라진다(prod 실측). 그럴 땐 질문만 싣고,
                 * 복원 쪽에서 같은 경로로 다시 태운다.
                 */
                pushShareUrl(lastIntent, selectedRegionCode, query || undefined);
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
          {isLayerCubeLoading ? (
            <section className="empty-state" data-testid="layer-cube-loading">
              <p className="ui-body-lg font-bold text-slate-800">{analysis.summary}</p>
              <p className="ui-body mt-1.5 text-slate-500">
                잠시 후 순위와 지도가 자동으로 갱신됩니다.
              </p>
            </section>
          ) : null}
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
                    ? `${Math.min(effectiveLimit, filteredFacilitiesList.length)}/${filteredFacilitiesList.length}`
                    : `${Math.min(effectiveLimit, filteredRanked.length)}/${filteredRanked.length}`}
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
                        <span className="rank-name block truncate">{facility.name}</span>
                        <span className="rank-note mt-0.5 block">
                          {facility.type} · {facility.adm_nm.replace(/^경상남도\s*/, "")}
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
                        /*
                         * 이름과 값 사이에 읽을 구분이 없으면 붙어서 읽힌다. 격자 이름은
                         * 숫자로 끝나므로("…500m격자 6") 값과 이어지면 "격자 612,893명"이
                         * 된다 — 스크린리더에게도, 화면 텍스트를 읽는 검증 스크립트에게도
                         * 없는 숫자가 생긴다.
                         */
                        aria-label={`${
                          analysis.ranked.findIndex((item) => item.code === row.code) + 1 || index + 1
                        }위 ${row.name}, ${row.valueLabel}`}
                        onPointerDown={() => selectRegion(row.code)}
                        onClick={(event) => {
                          if (event.detail === 0) selectRegion(row.code);
                        }}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full ui-chip font-black ${
                            (analysis.ranked.findIndex((item) => item.code === row.code) < 3
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600")
                          }`}
                          title={`표시 ${index + 1} · 전체 순위 ${analysis.ranked.findIndex((item) => item.code === row.code) + 1}`}
                        >
                          {analysis.ranked.findIndex((item) => item.code === row.code) + 1 ||
                            index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="rank-name block truncate">{row.name}</span>
                          {/*
                            note가 "총생활인구 · 97,787.3명"이면 오른쪽 값(97,787.3명)과
                            패널 제목(총생활인구 순위)을 합친 것과 같아, 한 줄에 같은 숫자가
                            두 번 찍혔다. 교차·추세 결과처럼 note가 다른 것을 말할 때만 남긴다.
                          */}
                          {row.note && !row.note.endsWith(row.valueLabel) ? (
                            <span className="rank-note mt-0.5 block">{row.note}</span>
                          ) : null}
                        </span>
                        <span className="rank-value">{row.valueLabel}</span>
                      </button>
                      {/* 점수가 없는 결과(상관·이상치)는 막대를 그리지 않는다. 길이가 곧
                          "이만큼"이라는 주장이라, 없는 점수로 그리면 거짓을 그린다. */}
                      {row.mapScore === null ? null : (
                        <span className="score-bar ml-9" aria-hidden>
                          <span style={{ width: `${Math.max(6, Math.min(100, row.mapScore))}%` }} />
                        </span>
                      )}
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
                ? filteredFacilitiesList.length > effectiveLimit
                : filteredRanked.length > effectiveLimit) ? (
                <button
                  type="button"
                  className="w-full border-t border-slate-100 py-2.5 ui-body font-bold text-blue-700 hover:bg-slate-50"
                  data-testid="result-load-more"
                  onClick={() => setResultLimit((value) => value + RESULT_PAGE_STEP)}
                >
                  더 보기 (
                  {(analysis.isFacilityResult
                    ? filteredFacilitiesList.length
                    : filteredRanked.length) - effectiveLimit}
                  개 남음)
                </button>
              ) : null}
              {!isLayerCubeLoading && !analysis.isFacilityResult && filteredRanked.length === 0 ? (
                <p className="px-3.5 py-4 ui-body text-slate-500">검색 결과가 없습니다.</p>
              ) : null}
              {!isLayerCubeLoading && analysis.isFacilityResult && filteredFacilitiesList.length === 0 ? (
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
