/** Server-only orchestration; imported by the AI Route Handler and server-side tests only. */
import {
  createChatCompletion,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_PRIMARY_MODEL,
  LlmError,
  type LlmClientDeps,
  type LlmFailureCode,
} from "./llm";
import { AnalysisIntentSchema, type AnalysisIntent } from "@/lib/analysis/intent-schema";
import { buildAiToolGuide } from "@/lib/analysis/query-catalog";
import {
  QUERY_SUGGESTIONS,
  assessQuerySafety,
  resolveQueryWithRules,
  type QueryEnrichment,
} from "@/lib/analysis/query-rules";
import { recordAiFailure, recordAiSuccess } from "./last-outcome";
import { augmentQueryWithRag } from "@/lib/rag/augment";
import {
  catalogMetricsFromChunkIds,
  findCatalogMetric,
} from "@/lib/rag/catalog-chunks";
import { formatRagContext, type RagHit } from "@/lib/rag/retrieve";
import { augmentQueryWithRagRemote } from "@/lib/rag/augment-remote";

export interface ParseIntentDeps extends LlmClientDeps {
  primaryModel?: string;
  fallbackModel?: string;
  /**
   * Optional remote embed re-rank for RAG (server only).
   * Default: env RAG_REMOTE_EMBED=1 or EMBED_MODEL set.
   */
  useRemoteRagEmbed?: boolean;
}

/**
 * 모델이 지목한 민간데이터 지표. `AnalysisIntent`(공공 tool 레지스트리)와는 다른 갈래라
 * 스키마를 건드리지 않고 따로 싣는다. 이 값이 오면 클라이언트가 민간 리졸버를 그 지표로
 * 한 번 더 돌린다 — 지금까지 "바로 분석하기 어렵습니다"로 끝나던 자리다.
 */
export interface MetricHint {
  layerId: string;
  metricKey: string;
  metricLabel: string;
  layerLabel: string;
}

export interface ParseIntentResult {
  intent: AnalysisIntent | null;
  mode: "live" | "demo";
  notice?: string;
  suggestions?: string[];
  enrichment?: QueryEnrichment;
  parser?: "ai" | "rules" | "hybrid";
  metricHint?: MetricHint;
  rag?: {
    citations: Array<{ id: string; title: string }>;
    hitCount: number;
  };
  /**
   * 왜 이 경로로 답했는지. 예전에는 AI 호출 실패를 전부 조용히 삼켜, 운영에서 AI 파서가
   * 한 번도 동작하지 않는데도 상태표는 "켜짐"이었다. 제공사·모델·키가 드러나지 않는
   * 낱말만 담는다(응답 privacy 테스트가 이 규칙을 지킨다).
   */
  diagnostics?: {
    aiAttempted: boolean;
    aiUsed: boolean;
    failures: LlmFailureCode[];
  };
}

/**
 * RAG 히트에서 고를 수 있는 민간 지표 후보를 만든다.
 *
 * 카탈로그 52개 지표를 매 요청에 다 실으면 프롬프트가 그만큼 커진다. 검색이
 * 이미 좁혀 준 것만 싣고, 모델이 고른 값은 다시 카탈로그로 확인한다.
 */
function metricHintSection(hits: RagHit[]): string {
  const candidates = catalogMetricsFromChunkIds(hits.map((hit) => hit.chunk.id));
  if (candidates.length === 0) return "";

  const lines = candidates.map(
    ({ layer, metric }) =>
      `- layerId="${layer.id}" metricKey="${metric.key}" → ${layer.label}·${metric.label}(${layer.provider}, ${metric.unit || "무단위"})`,
  );

  return [
    "",
    "등록된 tool로 답할 수 없지만 아래 민간데이터 지표 중 하나를 묻는 질의라면,",
    '{"tool":"privateMetric","layerId":"…","metricKey":"…"} 형태로만 답하세요:',
    ...lines,
    "",
  ].join("\n");
}

function systemPrompt(query: string, hits: RagHit[]): string {
  const context = formatRagContext(hits);
  const ragSection = context
    ? [
        "",
        `관련 지식(RAG, id=${hits.map((hit) => hit.chunk.id).join(", ")}):`,
        context,
        "위 지식을 우선 반영해 tool을 고르세요. 지식과 충돌하는 추정은 하지 마세요.",
        metricHintSection(hits),
      ].join("\n")
    : "";
  return `당신은 누리맵(경남 공간데이터 분석)의 자연어 의도 파서입니다.
분석 범위: 경상남도 행정동. 구어체·반말·오탈자 질의도 허용된 tool JSON으로만 변환하세요.
분석 범위 밖이면: {"tool":"unsupported","filters":{},"reason":"짧은 한국어 안내"}

등록된 tool 카탈로그:
${buildAiToolGuide()}
${ragSection}

filters optional:
- facilityTypes, includePharmacy, radiusKm(1~3), requireNightHours, requireWeekendHours
- regions, compare, limit(1~600)

규칙:
1. "병원"은 약국 제외 의료기관 전체. "약국"·"치과"·"한의원"은 명시 시에만 해당 유형.
2. 지역명은 정식 시·구·군명으로 정규화 (창원→창원시 의창구, 의창구→창원시 의창구, 진해→창원시 진해구, 마산→창원시 마산합포구, 김해→김해시, 진주→진주시, 양산→양산시).
3. 구·시 1개 + 현황/어때/상세 → getRegionDetails. 2개 비교/vs → compareRegions.
4. 사망/출생/자연감소/인구밀도/총인구/고령화율/1인가구/인구증감을 해당 rank* tool에 연결.
5. "부족·취약·공백" + 의료 → rankHospitalScarcity. 고령+의료 부족 → rankElderlyUnderserved.
6. 반경·km·이내 + 병원 수 → countFacilitiesWithinRadius. 먼/최근접 거리 → nearestFacilityDistance.
7. 근처·주변 장소 → filterFacilitiesByTypeAndHours (regions에 시·구 넣기). 카카오 보강은 클라이언트가 함.
8. 스키마 외 키·SQL·코드 금지. 전입전출·도로거리·응급·날씨 등 미등록만 unsupported.

예시:
- "사망자 많은 곳" → {"tool":"rankDeathCount","filters":{"limit":20}}
- "인구밀도 높은 동" → {"tool":"rankPopulationDensity","filters":{"limit":20}}
- "어디가 제일 의료 취약해" → {"tool":"rankHospitalScarcity","filters":{"limit":20}}
- "창원 의료 취약" → {"tool":"rankHospitalScarcity","filters":{"regions":["창원시 의창구"],"limit":20}}
- "김해 근처 병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["종합병원","병원","요양병원","의원","치과의원","한의원","보건소"],"regions":["김해시"]}}
- "김해시 어때" → {"tool":"getRegionDetails","filters":{"regions":["김해시"]}}
- "창원 vs 김해" → {"tool":"compareRegions","filters":{"compare":["창원시 의창구","김해시"]}}
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

function toolOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("tool" in value)) return null;
  const tool = (value as { tool: unknown }).tool;
  return typeof tool === "string" ? tool : null;
}

function isUnsupportedPayload(value: unknown): value is AiUnsupported {
  return toolOf(value) === "unsupported";
}

/**
 * 모델이 고른 민간 지표. 카탈로그에 실제로 있는 쌍일 때만 통과시킨다 — 모델이 지어낸
 * 이름을 그대로 화면에 흘리면, 없는 지표를 "전환했습니다"라고 말하게 된다.
 */
function readMetricHint(value: unknown): MetricHint | null {
  if (toolOf(value) !== "privateMetric") return null;

  const record = value as { layerId?: unknown; metricKey?: unknown };
  const layerId = typeof record.layerId === "string" ? record.layerId.trim() : "";
  const metricKey = typeof record.metricKey === "string" ? record.metricKey.trim() : "";
  if (!layerId || !metricKey) return null;

  const found = findCatalogMetric(layerId, metricKey);
  if (!found) return null;

  return {
    layerId: found.layer.id,
    metricKey: found.metric.key,
    metricLabel: found.metric.label,
    layerLabel: found.layer.label,
  };
}

type AiParseOutcome =
  | { kind: "intent"; intent: AnalysisIntent }
  | { kind: "metricHint"; hint: MetricHint }
  | { kind: "unsupported"; reason: string };

async function callAiParser(
  query: string,
  deps: ParseIntentDeps,
  model: string,
  hits: RagHit[],
): Promise<AiParseOutcome> {
  const raw = await createChatCompletion(deps, {
    model,
    messages: [
      { role: "system", content: systemPrompt(query, hits) },
      { role: "user", content: `사용자 질의: "${query}"` },
    ],
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    enableThinking: false,
    timeoutMs: 12_000,
  });

  const hint = readMetricHint(raw);
  if (hint) {
    return { kind: "metricHint", hint };
  }

  if (isUnsupportedPayload(raw)) {
    return {
      kind: "unsupported",
      reason:
        typeof raw.reason === "string" && raw.reason.trim()
          ? raw.reason.trim()
          : "현재 데이터와 분석 도구로 바로 답하기 어려운 질문입니다.",
    };
  }

  return { kind: "intent", intent: AnalysisIntentSchema.parse(raw) };
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
  /*
   * 임베딩은 채팅 모델과 같은 제공자에 있으리라 가정하면 안 된다 — 현재 채팅 제공자
   * (DeepSeek)에는 임베딩 엔드포인트가 아예 없다. 그래서 채팅 자격증명을 물려받지 않고
   * 자기 환경변수를 갖는다. 없으면 오프라인 해시 임베딩으로 간다(품질만 낮고 정상 동작).
   */
  const embedBaseUrl = process.env.EMBED_BASE_URL?.trim();
  const embedApiKey = process.env.EMBED_API_KEY?.trim();
  const wantRemote =
    deps.useRemoteRagEmbed === true ||
    process.env.RAG_REMOTE_EMBED?.trim() === "1" ||
    Boolean(process.env.EMBED_MODEL?.trim());
  const embedDeps =
    wantRemote && embedApiKey && embedBaseUrl
      ? {
          apiKey: embedApiKey,
          baseUrl: embedBaseUrl,
          model: process.env.EMBED_MODEL,
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
      diagnostics: { aiAttempted: false, aiUsed: false, failures: [] },
    };
  }

  const ruleResult = fromRules(safety.query);

  /*
   * 규칙이 답을 낸 질의는 규칙이 답한다.
   *
   * 이 라우팅은 회귀 검증(라우팅 56·값 46·표면 22)으로 잠겨 있다. 값싼 모델의 한 번짜리
   * 판단으로 그것을 뒤집으면, 뒤집힌 자리를 아무도 세지 않는다. 모델은 규칙이 놓친
   * 표현에만 쓴다 — 지금 "바로 분석하기 어렵습니다"로 끝나던 바로 그 자리다.
   * 부수 효과로 호출량이 규칙 미스에만 걸려 비용도 그만큼만 든다.
   */
  if (ruleResult.intent) {
    return attachRagMetaAsync(
      safety.query,
      { ...ruleResult, diagnostics: { aiAttempted: false, aiUsed: false, failures: [] } },
      deps,
    );
  }

  const apiKey = deps.apiKey?.trim();
  const primaryModel = deps.primaryModel?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = deps.fallbackModel?.trim() || DEFAULT_FALLBACK_MODEL;

  if (!apiKey) {
    return attachRagMetaAsync(
      safety.query,
      {
        ...ruleResult,
        diagnostics: {
          aiAttempted: false,
          aiUsed: false,
          failures: ["credential_missing"],
        },
      },
      deps,
    );
  }

  const failures: LlmFailureCode[] = [];
  const hits = augmentQueryWithRag(safety.query).hits;

  for (const model of [primaryModel, primaryModel, fallbackModel]) {
    try {
      const parsed = await callAiParser(safety.query, deps, model, hits);
      const diagnostics = { aiAttempted: true, aiUsed: true, failures: [...failures] };
      recordAiSuccess();

      if (parsed.kind === "metricHint") {
        return attachRagMetaAsync(
          safety.query,
          {
            intent: null,
            mode: "live",
            notice: `${parsed.hint.layerLabel} · ${parsed.hint.metricLabel} 지표를 묻는 질문으로 읽었습니다.`,
            parser: "ai",
            metricHint: parsed.hint,
            diagnostics,
          },
          deps,
        );
      }

      if (parsed.kind === "unsupported") {
        return attachRagMetaAsync(
          safety.query,
          {
            intent: null,
            mode: "live",
            notice: parsed.reason,
            suggestions: [...QUERY_SUGGESTIONS],
            parser: "ai",
            diagnostics,
          },
          deps,
        );
      }

      return attachRagMetaAsync(
        safety.query,
        {
          intent: parsed.intent,
          mode: "live",
          notice: "질문을 분석에 반영했습니다.",
          enrichment: ruleResult.enrichment,
          parser: ruleResult.enrichment ? "hybrid" : "ai",
          diagnostics,
        },
        deps,
      );
    } catch (error) {
      const code: LlmFailureCode =
        error instanceof LlmError ? error.code : "upstream_unreachable";
      failures.push(code);
      recordAiFailure(code);

      /*
       * 실패를 조용히 삼키면 "AI가 켜져 있는데 한 번도 안 붙는" 상태를 아무도 못 본다.
       * 서버 로그에는 사유를 남기고, 응답에는 제공사가 드러나지 않는 낱말만 싣는다.
       */
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[ai/parse] attempt failed: ${code}`);
      }

      // 자격증명·과금 거절은 다시 걸어도 같다. 사용자를 두 번 더 기다리게 하지 않는다.
      if (code === "upstream_rejected") break;
    }
  }

  return attachRagMetaAsync(
    safety.query,
    {
      ...ruleResult,
      notice:
        ruleResult.notice ??
        "지금은 자동 해석에 실패했습니다. 빠른 분석 버튼이나 예시 질문으로 이어서 볼 수 있습니다.",
      suggestions: ruleResult.suggestions ?? [...QUERY_SUGGESTIONS],
      parser: "rules",
      diagnostics: { aiAttempted: true, aiUsed: false, failures },
    },
    deps,
  );
}
