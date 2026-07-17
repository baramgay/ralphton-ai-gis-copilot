/** Server-only orchestration; imported by the AI Route Handler and server-side tests only. */
import { createQwenCompletion, type QwenClientDeps } from "./qwen";
import { AnalysisIntentSchema, type AnalysisIntent } from "@/lib/analysis/intent-schema";
import { buildAiToolGuide } from "@/lib/analysis/query-catalog";
import {
  QUERY_SUGGESTIONS,
  assessQuerySafety,
  resolveQueryWithRules,
  type QueryEnrichment,
} from "@/lib/analysis/query-rules";

export interface ParseIntentDeps extends QwenClientDeps {
  primaryModel?: string;
  fallbackModel?: string;
}

export interface ParseIntentResult {
  intent: AnalysisIntent | null;
  mode: "live" | "demo";
  notice?: string;
  suggestions?: string[];
  enrichment?: QueryEnrichment;
  parser?: "ai" | "rules" | "hybrid";
}

const DEFAULT_PRIMARY_MODEL = "qwen3.6-flash";
const DEFAULT_FALLBACK_MODEL = "qwen3.7-plus";

function systemPrompt(): string {
  return `당신은 부산 AI GIS Copilot의 자연어 의도 파서입니다.
사용자 질의를 허용된 tool JSON으로만 변환하세요.
분석 범위 밖이면: {"tool":"unsupported","filters":{},"reason":"짧은 한국어 안내"}

등록된 tool 카탈로그:
${buildAiToolGuide()}

filters optional:
- facilityTypes, includePharmacy, radiusKm(1~3), requireNightHours, requireWeekendHours
- regions, compare, limit(1~250)

규칙:
1. "병원"은 약국 제외 의료기관. "약국"은 명시 시에만.
2. 지역명은 regions/compare에 부산 구·군명을 넣습니다.
3. 사망/출생/자연감소/인구밀도/총인구/고령화율 질의를 해당 tool에 연결하세요.
4. 근처·주변 장소는 filterFacilitiesByTypeAndHours + 클라이언트 카카오 보강이 가능합니다.
5. 스키마 외 키·SQL·코드 금지.
6. 전입전출·도로거리·응급 통계 등 미등록 지표만 unsupported.

예시:
- "사망자 많은 곳" → {"tool":"rankDeathCount","filters":{"limit":20}}
- "인구밀도 높은 동" → {"tool":"rankPopulationDensity","filters":{"limit":20}}
- "해운대 근처 병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["종합병원","병원","요양병원","의원","치과의원","한의원","보건소"]}}
- "오늘 날씨" → {"tool":"unsupported","filters":{},"reason":"날씨 정보는 제공하지 않습니다."}

JSON 객체 하나만 출력하세요.`;
}

type AiUnsupported = {
  tool: "unsupported";
  filters: Record<string, unknown>;
  reason?: string;
};

function isUnsupportedPayload(value: unknown): value is AiUnsupported {
  return (
    typeof value === "object" &&
    value !== null &&
    "tool" in value &&
    (value as { tool: unknown }).tool === "unsupported"
  );
}

async function callAiParser(
  query: string,
  deps: ParseIntentDeps,
  model: string,
): Promise<AnalysisIntent | { unsupported: true; reason: string }> {
  const raw = await createQwenCompletion(deps, {
    model,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: `사용자 질의: "${query}"` },
    ],
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    enableThinking: false,
    timeoutMs: 12_000,
  });

  if (isUnsupportedPayload(raw)) {
    return {
      unsupported: true,
      reason:
        typeof raw.reason === "string" && raw.reason.trim()
          ? raw.reason.trim()
          : "현재 데이터와 분석 도구로 바로 답하기 어려운 질문입니다.",
    };
  }

  return AnalysisIntentSchema.parse(raw);
}

function fromRules(query: string): ParseIntentResult {
  const resolved = resolveQueryWithRules(query);

  if (resolved.kind === "intent") {
    return {
      intent: resolved.intent,
      mode: "demo",
      notice: resolved.notice,
      enrichment: resolved.enrichment,
      parser: "rules",
    };
  }

  if (resolved.kind === "unsafe") {
    return {
      intent: null,
      mode: "demo",
      notice: resolved.notice,
      parser: "rules",
    };
  }

  return {
    intent: null,
    mode: "demo",
    notice: resolved.notice,
    suggestions: resolved.suggestions,
    parser: "rules",
  };
}

export async function parseIntentWithFallbacks(
  query: string,
  deps: ParseIntentDeps,
): Promise<ParseIntentResult> {
  const safety = assessQuerySafety(query);

  if (!safety.safe) {
    const resolved = resolveQueryWithRules(query);
    return {
      intent: null,
      mode: "demo",
      notice: resolved.notice,
      suggestions: resolved.kind === "unsupported" ? resolved.suggestions : [...QUERY_SUGGESTIONS],
      parser: "rules",
    };
  }

  const apiKey = deps.apiKey?.trim();
  const baseUrl = deps.baseUrl?.trim();
  const primaryModel = deps.primaryModel?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = deps.fallbackModel?.trim() || DEFAULT_FALLBACK_MODEL;
  const ruleResult = fromRules(safety.query);

  if (!apiKey || !baseUrl) {
    return ruleResult;
  }

  for (const model of [primaryModel, primaryModel, fallbackModel]) {
    try {
      const parsed = await callAiParser(safety.query, deps, model);

      if ("unsupported" in parsed && parsed.unsupported) {
        if (ruleResult.intent) {
          return {
            ...ruleResult,
            mode: "live",
            parser: "hybrid",
            notice: ruleResult.notice,
          };
        }
        return {
          intent: null,
          mode: "live",
          notice: parsed.reason,
          suggestions: [...QUERY_SUGGESTIONS],
          parser: "ai",
        };
      }

      // Prefer AI intent when valid; keep rule enrichment for Kakao nearby cues.
      return {
        intent: parsed as AnalysisIntent,
        mode: "live",
        notice: "질문을 분석에 반영했습니다.",
        enrichment: ruleResult.enrichment,
        parser: ruleResult.enrichment ? "hybrid" : "ai",
      };
    } catch {
      // retry / fallback model
    }
  }

  if (ruleResult.intent) {
    return {
      ...ruleResult,
      notice: ruleResult.notice ?? "질문을 분석에 반영했습니다.",
      parser: "rules",
    };
  }

  return {
    intent: null,
    mode: "demo",
    notice:
      ruleResult.notice ??
      "지금은 자동 해석에 실패했습니다. 빠른 분석 버튼이나 예시 질문으로 이어서 볼 수 있습니다.",
    suggestions: ruleResult.suggestions ?? [...QUERY_SUGGESTIONS],
    parser: "rules",
  };
}
