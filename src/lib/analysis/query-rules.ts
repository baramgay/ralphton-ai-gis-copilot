import { AnalysisIntentSchema, type AnalysisIntent } from "./intent-schema";
import {
  TOOL_CATALOG,
  scoreCatalogEntry,
} from "./query-catalog";
import {
  BUSAN_DISTRICT_LABELS,
  DISTRICT_LABELS,
  QUERY_SUGGESTIONS,
} from "./query-catalog-meta";
import { extractQuerySignals, type QuerySignals } from "./query-signals";

export { BUSAN_DISTRICT_LABELS, DISTRICT_LABELS, QUERY_SUGGESTIONS };
export type { QuerySignals };

export const MAX_QUERY_LENGTH = 1000;

/** Minimum catalog score to accept a rule-based intent. */
const INTENT_SCORE_THRESHOLD = 42;
/** Soft accept when one tool clearly wins and has a primary metric cue. */
const SOFT_SCORE_THRESHOLD = 32;
const SOFT_SCORE_GAP = 10;

const DANGEROUS_KEYWORDS = [
  "shell",
  "sql",
  "select",
  "insert",
  "update",
  "delete",
  "drop",
  "exec",
  "eval",
  "bash",
  "cmd",
  "powershell",
];

const SUSPICIOUS_PUNCTUATION = /[;`{}]|\/\//;
const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:km|키로|킬로)/gi;

export type QuerySafetyResult =
  | { safe: true; query: string }
  | { safe: false; reason: "empty" | "too-long" | "dangerous-token" | "radius" };

export type SafetyReason = "empty" | "too-long" | "dangerous-token" | "radius";

export type QueryEnrichment = {
  kakaoPlacesQuery?: string;
  kakaoCategory?: "HP8" | "PM9";
};

export type RuleParseResult =
  | {
      kind: "intent";
      intent: AnalysisIntent;
      notice: string;
      score: number;
      enrichment?: QueryEnrichment;
    }
  | {
      kind: "unsupported";
      intent: null;
      notice: string;
      suggestions: string[];
    }
  | {
      kind: "unsafe";
      intent: null;
      notice: string;
      reason: SafetyReason;
    };

export function assessQuerySafety(query: string): QuerySafetyResult {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return { safe: false, reason: "empty" };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return { safe: false, reason: "too-long" };
  }

  const lower = trimmed.toLowerCase();

  if (DANGEROUS_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return { safe: false, reason: "dangerous-token" };
  }

  if (SUSPICIOUS_PUNCTUATION.test(trimmed)) {
    return { safe: false, reason: "dangerous-token" };
  }

  for (const radiusMatch of trimmed.matchAll(RADIUS_PATTERN)) {
    const radius = Number.parseFloat(radiusMatch[1]);
    if (Number.isFinite(radius) && (radius < 1 || radius > 3)) {
      return { safe: false, reason: "radius" };
    }
  }

  return { safe: true, query: trimmed };
}

function safetyNotice(reason: SafetyReason): string {
  switch (reason) {
    case "empty":
      return "질문을 입력해 주세요. 예: 사망자 많은 곳, 해운대 근처 병원";
    case "too-long":
      return "질문이 너무 깁니다. 핵심만 짧게 다시 적어 주세요.";
    case "radius":
      return "접근 반경은 1·2·3km만 분석할 수 있습니다. 예: 2km 안에 병원이 적은 곳";
    case "dangerous-token":
    default:
      return "보안상 처리할 수 없는 표현이 포함되어 있습니다. 일반 분석 질문으로 다시 물어봐 주세요.";
  }
}

function withLimit(filters: AnalysisIntent["filters"], limit = 20): AnalysisIntent["filters"] {
  return { ...filters, limit: filters.limit ?? limit };
}

function buildEnrichment(signals: QuerySignals): QueryEnrichment | undefined {
  if (!signals.metrics.has("kakaoLive") && !signals.spatial.has("nearby")) {
    return undefined;
  }
  const query = signals.freePlaceQuery ?? "병원";
  const enrichment: QueryEnrichment = { kakaoPlacesQuery: query };
  if (signals.metrics.has("pharmacy") || query.includes("약국")) {
    enrichment.kakaoCategory = "PM9";
  } else if (signals.metrics.has("medical") || /병원|의원|의료/.test(query)) {
    enrichment.kakaoCategory = "HP8";
  }
  return enrichment;
}

function topSuggestions(signals: QuerySignals): string[] {
  const scored = TOOL_CATALOG.map((entry) => ({
    entry,
    score: scoreCatalogEntry(entry, signals),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .flatMap((item) => item.entry.examples.slice(0, 1));

  const unique = [...new Set([...scored, ...QUERY_SUGGESTIONS])];
  return unique.slice(0, 8);
}

/**
 * Score every registered tool against extracted signals and pick the best.
 * New GIS tools only need a TOOL_CATALOG row + registry implementation.
 */
export function resolveQueryWithRules(query: string): RuleParseResult {
  const safety = assessQuerySafety(query);

  if (!safety.safe) {
    return {
      kind: "unsafe",
      intent: null,
      notice: safetyNotice(safety.reason),
      reason: safety.reason,
    };
  }

  const signals = extractQuerySignals(safety.query);
  const ranked = TOOL_CATALOG.map((entry) => ({
    entry,
    score: scoreCatalogEntry(entry, signals),
  })).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];

  const clearWinner =
    best &&
    best.score >= SOFT_SCORE_THRESHOLD &&
    (!second || best.score - second.score >= SOFT_SCORE_GAP);
  const hardWinner = best && best.score >= INTENT_SCORE_THRESHOLD;

  if (best && (hardWinner || clearWinner)) {
    const filters = withLimit(best.entry.build(signals));
    const intent = AnalysisIntentSchema.parse({
      tool: best.entry.id,
      filters,
    });

    return {
      kind: "intent",
      intent,
      notice: best.entry.notice(signals),
      score: best.score,
      enrichment: buildEnrichment(signals),
    };
  }

  // Dong-only soft path: "송정동 현황"
  if (signals.dongs.length >= 1 && signals.metrics.size === 0 && !signals.spatial.has("compare")) {
    const codes = signals.dongs.slice(0, 5).map((dong) => dong.adm_cd2);
    const intent = AnalysisIntentSchema.parse({
      tool: "getRegionDetails",
      filters: withLimit({ regions: codes }, 50),
    });
    return {
      kind: "intent",
      intent,
      notice: `${signals.dongs.map((d) => d.shortName).join("·")} 상세 지표를 표시합니다.`,
      score: 56,
    };
  }

  // District-only soft path: "수영구 어때" style
  if (signals.districts.length === 1 && signals.metrics.size === 0 && signals.dongs.length === 0) {
    const intent = AnalysisIntentSchema.parse({
      tool: "getRegionDetails",
      filters: withLimit({ regions: [signals.districts[0]] }, 50),
    });
    return {
      kind: "intent",
      intent,
      notice: `${signals.districts[0]} 상세 지표를 표시합니다. 순위·비교를 원하시면 지표를 함께 적어 주세요.`,
      score: 50,
    };
  }

  // Nearby place queries without enough chart tool score → facility list + kakao enrichment
  if (signals.spatial.has("nearby") || signals.metrics.has("kakaoLive")) {
    const intent = AnalysisIntentSchema.parse({
      tool: "filterFacilitiesByTypeAndHours",
      filters: withLimit({
        facilityTypes: signals.includePharmacy
          ? ["약국"]
          : signals.facilityTypes.length > 0
            ? signals.facilityTypes
            : ["종합병원", "병원", "요양병원", "의원", "치과의원", "한의원", "보건소"],
        regions: signals.districts.length ? signals.districts.slice(0, 3) : undefined,
      }),
    });
    return {
      kind: "intent",
      intent,
      notice: "주변 장소를 스냅샷 시설과 카카오 실시간 검색으로 함께 확인합니다.",
      score: 55,
      enrichment: buildEnrichment(signals),
    };
  }

  // Facility type only: "치과 보여줘"
  if (signals.facilityTypes.length > 0 || signals.metrics.has("pharmacy")) {
    const intent = AnalysisIntentSchema.parse({
      tool: "filterFacilitiesByTypeAndHours",
      filters: withLimit({
        facilityTypes: signals.includePharmacy
          ? signals.facilityTypes.length
            ? signals.facilityTypes
            : ["약국"]
          : signals.facilityTypes,
        includePharmacy: signals.includePharmacy || undefined,
        regions: signals.districts.length ? signals.districts.slice(0, 3) : undefined,
      }),
    });
    return {
      kind: "intent",
      intent,
      notice: "요청하신 시설 유형을 지도에 표시했습니다.",
      score: 50,
      enrichment: buildEnrichment(signals),
    };
  }

  return {
    kind: "unsupported",
    intent: null,
    notice:
      "질문을 해석했지만 현재 등록된 분석 도구와 충분히 맞지 않습니다. 예: 「사망자 많은 곳」, 「해운대 근처 병원」, 「기장 vs 강서 비교」, 「2km 병원 적은 동」처럼 지표·지역·거리를 넣어 주세요.",
    suggestions: topSuggestions(signals),
  };
}

/** Backward-compatible helper used by tests and clients. */
export function parseIntentWithRules(query: string): AnalysisIntent | null {
  const resolved = resolveQueryWithRules(query);
  return resolved.intent;
}

export function validateIntent(value: unknown): AnalysisIntent | null {
  const parsed = AnalysisIntentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** For debugging / future admin UI */
export function explainQueryScores(query: string): Array<{ tool: string; score: number; label: string }> {
  const safety = assessQuerySafety(query);
  if (!safety.safe) return [];
  const signals = extractQuerySignals(safety.query);
  return TOOL_CATALOG.map((entry) => ({
    tool: entry.id,
    label: entry.label,
    score: scoreCatalogEntry(entry, signals),
  })).sort((a, b) => b.score - a.score);
}
