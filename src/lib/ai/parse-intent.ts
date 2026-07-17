/** Server-only orchestration; imported by the AI Route Handler and server-side tests only. */
import { createQwenCompletion, type QwenClientDeps } from './qwen';
import { AnalysisIntentSchema, type AnalysisIntent } from '@/lib/analysis/intent-schema';
import {
  QUERY_SUGGESTIONS,
  assessQuerySafety,
  resolveQueryWithRules,
} from '@/lib/analysis/query-rules';

export interface ParseIntentDeps extends QwenClientDeps {
  primaryModel?: string;
  fallbackModel?: string;
}

export interface ParseIntentResult {
  intent: AnalysisIntent | null;
  mode: 'live' | 'demo';
  notice?: string;
  suggestions?: string[];
}

/** Structured intent JSON only — prefer Flash for cost; Plus as quality fallback. */
const DEFAULT_PRIMARY_MODEL = 'qwen3.6-flash';
const DEFAULT_FALLBACK_MODEL = 'qwen3.7-plus';

const SYSTEM_PROMPT = `당신은 부산 의료·인구 접근성 분석 AI GIS Copilot의 자연어 의도 파서입니다.
사용자 질의를 아래 JSON 스키마에 엄격히 맞는 의도 객체로 변환하세요.
분석 범위 밖(날씨, 맛집, 정치, 일반 상식 등)이면 tool 대신 이 형태만 반환하세요:
{"tool":"unsupported","filters":{},"reason":"짧은 한국어 안내"}

허용 tool 목록:
- rankHospitalScarcity (의료 취약·공급 부족·병원이 없는 곳)
- rankElderlyUnderserved (고령·노인·어르신 대비 의료 부족)
- rankPopulationGrowthPressure (인구 증가·늘어나는 지역·공급 압력)
- rankPopulationDeclineRisk (인구 감소·줄어드는 지역)
- rankSingleHouseholdRisk (1인가구·단독가구)
- filterFacilitiesByTypeAndHours (병원/약국/야간/주말 등 시설 목록)
- compareRegions (구·군 비교, filters.compare에 지역명)
- nearestFacilityDistance (최근접 거리·먼 곳)
- countFacilitiesWithinRadius (1~3km 반경 접근성, filters.radiusKm)
- getRegionDetails (특정 구·동 상세, filters.regions)

허용 facilityTypes: 종합병원, 병원, 요양병원, 의원, 치과의원, 한의원, 보건소, 약국

filters optional keys:
- facilityTypes, includePharmacy, radiusKm(1~3), requireNightHours, requireWeekendHours
- regions, compare, limit(1~250)

규칙:
1. "병원"은 약국 제외 전체 의료기관. "약국"은 명시 시에만.
2. 지역명은 부산 구·군·동 표현을 regions/compare에 넣습니다.
3. 스키마 외 키 금지. SQL/코드/URL 금지.
4. 모르는 지표(전입전출, 도로거리, 응급의료 통계 등)는 unsupported.

예시:
- "고령 인구 대비 병원이 부족한 곳" → {"tool":"rankElderlyUnderserved","filters":{"limit":20}}
- "2km 안에 병원 적은 동" → {"tool":"countFacilitiesWithinRadius","filters":{"radiusKm":2,"limit":20}}
- "해운대구 알려줘" → {"tool":"getRegionDetails","filters":{"regions":["해운대구"]}}
- "기장이랑 강서 비교" → {"tool":"compareRegions","filters":{"compare":["기장군","강서구"]}}
- "야간 진료 병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"requireNightHours":true,"facilityTypes":["종합병원","병원","요양병원","의원","치과의원","한의원","보건소"]}}
- "오늘 날씨" → {"tool":"unsupported","filters":{},"reason":"날씨 정보는 제공하지 않습니다. 의료·인구 접근성 질문으로 물어봐 주세요."}

JSON 객체 하나만 출력하세요.`;

const AiRawSchema = AnalysisIntentSchema.or(
  AnalysisIntentSchema.extend({}).or(
    // handled manually below for unsupported
    AnalysisIntentSchema,
  ),
);

void AiRawSchema;

function buildUserPrompt(query: string): string {
  return `사용자 질의: "${query}"`;
}

type AiUnsupported = {
  tool: 'unsupported';
  filters: Record<string, unknown>;
  reason?: string;
};

function isUnsupportedPayload(value: unknown): value is AiUnsupported {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tool' in value &&
    (value as { tool: unknown }).tool === 'unsupported'
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
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(query) },
    ],
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
    enableThinking: false,
    timeoutMs: 12_000,
  });

  if (isUnsupportedPayload(raw)) {
    return {
      unsupported: true,
      reason:
        typeof raw.reason === 'string' && raw.reason.trim()
          ? raw.reason.trim()
          : '현재 데이터와 분석 도구로 바로 답하기 어려운 질문입니다.',
    };
  }

  return AnalysisIntentSchema.parse(raw);
}

function fromRules(query: string): ParseIntentResult {
  const resolved = resolveQueryWithRules(query);

  if (resolved.kind === 'intent') {
    return {
      intent: resolved.intent,
      mode: 'demo',
      notice: resolved.notice,
    };
  }

  if (resolved.kind === 'unsafe') {
    return {
      intent: null,
      mode: 'demo',
      notice: resolved.notice,
    };
  }

  return {
    intent: null,
    mode: 'demo',
    notice: resolved.notice,
    suggestions: resolved.suggestions,
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
      mode: 'demo',
      notice: resolved.notice,
      suggestions: resolved.kind === 'unsupported' ? resolved.suggestions : [...QUERY_SUGGESTIONS],
    };
  }

  const apiKey = deps.apiKey?.trim();
  const baseUrl = deps.baseUrl?.trim();
  const primaryModel = deps.primaryModel?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = deps.fallbackModel?.trim() || DEFAULT_FALLBACK_MODEL;

  // Always keep a deterministic rule result ready — used when AI is off or fails.
  const ruleResult = fromRules(safety.query);

  if (!apiKey || !baseUrl) {
    return ruleResult;
  }

  for (const model of [primaryModel, primaryModel, fallbackModel]) {
    try {
      const parsed = await callAiParser(safety.query, deps, model);

      if ('unsupported' in parsed && parsed.unsupported) {
        // AI said unsupported — still try rules in case the model was overly cautious.
        if (ruleResult.intent) {
          return {
            ...ruleResult,
            mode: 'live',
            notice: ruleResult.notice,
          };
        }

        return {
          intent: null,
          mode: 'live',
          notice: parsed.reason,
          suggestions: [...QUERY_SUGGESTIONS],
        };
      }

      return {
        intent: parsed as AnalysisIntent,
        mode: 'live',
        notice: '질문을 분석에 반영했습니다.',
      };
    } catch {
      // Continue through primary retry and plus fallback.
    }
  }

  // AI path failed entirely — rules still answer many everyday queries.
  if (ruleResult.intent) {
    return {
      ...ruleResult,
      notice: ruleResult.notice ?? '질문을 분석에 반영했습니다.',
    };
  }

  return {
    intent: null,
    mode: 'demo',
    notice:
      ruleResult.notice ??
      '지금은 자동 해석에 실패했습니다. 빠른 분석 버튼이나 예시 질문으로 이어서 볼 수 있습니다.',
    suggestions: ruleResult.suggestions ?? [...QUERY_SUGGESTIONS],
  };
}
