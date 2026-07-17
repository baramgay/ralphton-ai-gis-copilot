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
import { augmentQueryWithRag, buildRagPromptSection } from "@/lib/rag/augment";
import { augmentQueryWithRagRemote } from "@/lib/rag/augment-remote";

export interface ParseIntentDeps extends QwenClientDeps {
  primaryModel?: string;
  fallbackModel?: string;
  /**
   * Optional remote embed re-rank for RAG (server only).
   * Default: env RAG_REMOTE_EMBED=1 or QWEN_EMBED_MODEL set.
   */
  useRemoteRagEmbed?: boolean;
}

export interface ParseIntentResult {
  intent: AnalysisIntent | null;
  mode: "live" | "demo";
  notice?: string;
  suggestions?: string[];
  enrichment?: QueryEnrichment;
  parser?: "ai" | "rules" | "hybrid";
  rag?: {
    citations: Array<{ id: string; title: string }>;
    hitCount: number;
  };
}

const DEFAULT_PRIMARY_MODEL = "qwen3.6-flash";
const DEFAULT_FALLBACK_MODEL = "qwen3.7-plus";

function systemPrompt(query: string): string {
  const ragSection = buildRagPromptSection(query);
  return `당신은 부산 AI GIS Copilot의 자연어 의도 파서입니다.
구어체·반말·오탈자 질의도 허용된 tool JSON으로만 변환하세요.
분석 범위 밖이면: {"tool":"unsupported","filters":{},"reason":"짧은 한국어 안내"}

등록된 tool 카탈로그:
${buildAiToolGuide()}
${ragSection}

filters optional:
- facilityTypes, includePharmacy, radiusKm(1~3), requireNightHours, requireWeekendHours
- regions, compare, limit(1~250)

규칙:
1. "병원"은 약국 제외 의료기관 전체. "약국"·"치과"·"한의원"은 명시 시에만 해당 유형.
2. 지역명은 정식 구·군명으로 정규화 (해운대→해운대구, 기장→기장군, 진구→부산진구).
3. 구 1개 + 현황/어때/상세 → getRegionDetails. 구 2개 비교/vs → compareRegions.
4. 사망/출생/자연감소/인구밀도/총인구/고령화율/1인가구/인구증감을 해당 rank* tool에 연결.
5. "부족·취약·공백" + 의료 → rankHospitalScarcity. 고령+의료 부족 → rankElderlyUnderserved.
6. 반경·km·이내 + 병원 수 → countFacilitiesWithinRadius. 먼/최근접 거리 → nearestFacilityDistance.
7. 근처·주변 장소 → filterFacilitiesByTypeAndHours (regions에 구 넣기). 카카오 보강은 클라이언트가 함.
8. 스키마 외 키·SQL·코드 금지. 전입전출·도로거리·응급·날씨 등 미등록만 unsupported.

예시:
- "사망자 많은 곳" → {"tool":"rankDeathCount","filters":{"limit":20}}
- "인구밀도 높은 동" → {"tool":"rankPopulationDensity","filters":{"limit":20}}
- "어디가 제일 의료 취약해" → {"tool":"rankHospitalScarcity","filters":{"limit":20}}
- "해운대 근처 병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["종합병원","병원","요양병원","의원","치과의원","한의원","보건소"],"regions":["해운대구"]}}
- "수영구 어때" → {"tool":"getRegionDetails","filters":{"regions":["수영구"]}}
- "해운대 vs 기장" → {"tool":"compareRegions","filters":{"compare":["해운대구","기장군"]}}
- "2키로 안 병원 적은 동" → {"tool":"countFacilitiesWithinRadius","filters":{"radiusKm":2,"limit":20}}
- "야간 약국" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["약국"],"includePharmacy":true,"requireNightHours":true}}
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
      { role: "system", content: systemPrompt(query) },
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

function attachRagMeta(query: string, result: ParseIntentResult): ParseIntentResult {
  const rag = augmentQueryWithRag(query, { intent: result.intent });
  return {
    ...result,
    rag: {
      citations: rag.citations,
      hitCount: rag.hits.length,
    },
  };
}

async function attachRagMetaAsync(
  query: string,
  result: ParseIntentResult,
  deps: ParseIntentDeps,
): Promise<ParseIntentResult> {
  const wantRemote =
    deps.useRemoteRagEmbed === true ||
    process.env.RAG_REMOTE_EMBED?.trim() === "1" ||
    Boolean(process.env.QWEN_EMBED_MODEL?.trim());
  const embedDeps =
    wantRemote && deps.apiKey?.trim() && deps.baseUrl?.trim()
      ? {
          apiKey: deps.apiKey,
          baseUrl: deps.baseUrl,
          model: process.env.QWEN_EMBED_MODEL,
          fetch: deps.fetch,
        }
      : undefined;

  if (!embedDeps) {
    return attachRagMeta(query, result);
  }

  try {
    const rag = await augmentQueryWithRagRemote(query, {
      intent: result.intent,
      embedDeps,
    });
    return {
      ...result,
      rag: {
        citations: rag.citations,
        hitCount: rag.hits.length,
      },
    };
  } catch {
    return attachRagMeta(query, result);
  }
}

function fromRules(query: string): ParseIntentResult {
  const resolved = resolveQueryWithRules(query);

  if (resolved.kind === "intent") {
    return attachRagMeta(query, {
      intent: resolved.intent,
      mode: "demo",
      notice: resolved.notice,
      enrichment: resolved.enrichment,
      parser: "rules",
    });
  }

  if (resolved.kind === "unsafe") {
    return attachRagMeta(query, {
      intent: null,
      mode: "demo",
      notice: resolved.notice,
      parser: "rules",
    });
  }

  return attachRagMeta(query, {
    intent: null,
    mode: "demo",
    notice: resolved.notice,
    suggestions: resolved.suggestions,
    parser: "rules",
  });
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
    return attachRagMetaAsync(safety.query, ruleResult, deps);
  }

  for (const model of [primaryModel, primaryModel, fallbackModel]) {
    try {
      const parsed = await callAiParser(safety.query, deps, model);

      if ("unsupported" in parsed && parsed.unsupported) {
        if (ruleResult.intent) {
          return attachRagMetaAsync(
            safety.query,
            {
              ...ruleResult,
              mode: "live",
              parser: "hybrid",
              notice: ruleResult.notice,
            },
            deps,
          );
        }
        return attachRagMetaAsync(
          safety.query,
          {
            intent: null,
            mode: "live",
            notice: parsed.reason,
            suggestions: [...QUERY_SUGGESTIONS],
            parser: "ai",
          },
          deps,
        );
      }

      // Prefer AI intent when valid; keep rule enrichment for Kakao nearby cues.
      return attachRagMetaAsync(
        safety.query,
        {
          intent: parsed as AnalysisIntent,
          mode: "live",
          notice: "질문을 분석에 반영했습니다.",
          enrichment: ruleResult.enrichment,
          parser: ruleResult.enrichment ? "hybrid" : "ai",
        },
        deps,
      );
    } catch {
      // retry / fallback model
    }
  }

  if (ruleResult.intent) {
    return attachRagMetaAsync(
      safety.query,
      {
        ...ruleResult,
        notice: ruleResult.notice ?? "질문을 분석에 반영했습니다.",
        parser: "rules",
      },
      deps,
    );
  }

  return attachRagMetaAsync(
    safety.query,
    {
      intent: null,
      mode: "demo",
      notice:
        ruleResult.notice ??
        "지금은 자동 해석에 실패했습니다. 빠른 분석 버튼이나 예시 질문으로 이어서 볼 수 있습니다.",
      suggestions: ruleResult.suggestions ?? [...QUERY_SUGGESTIONS],
      parser: "rules",
    },
    deps,
  );
}
