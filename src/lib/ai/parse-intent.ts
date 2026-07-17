/** Server-only orchestration; imported by the AI Route Handler and server-side tests only. */
import { createQwenCompletion, type QwenClientDeps } from './qwen';
import { AnalysisIntentSchema, type AnalysisIntent } from '@/lib/analysis/intent-schema';
import { assessQuerySafety, parseIntentWithRules } from '@/lib/analysis/query-rules';

export interface ParseIntentDeps extends QwenClientDeps {
  primaryModel?: string;
  fallbackModel?: string;
}

export interface ParseIntentResult {
  intent: AnalysisIntent | null;
  mode: 'live' | 'demo';
  notice?: string;
}

/** Structured intent JSON only — prefer Flash for cost; Plus as quality fallback. */
const DEFAULT_PRIMARY_MODEL = 'qwen3.6-flash';
const DEFAULT_FALLBACK_MODEL = 'qwen3.7-plus';
const LOCAL_RULE_NOTICE = '로컬 규칙 기반 분석으로 처리했습니다.';
const UNSAFE_QUERY_NOTICE = '요청한 질의는 처리할 수 없습니다.';

const SYSTEM_PROMPT = `당신은 부산 의료·인구 접근성 분석 AI GIS Copilot의 자연어 의도 파서입니다.
사용자 질의를 아래 JSON 스키마에 엄격히 맞는 의도 객체로 변환하세요.

허용 tool 목록 (이외의 tool은 절대 사용하지 마세요):
- rankHospitalScarcity
- rankElderlyUnderserved
- rankPopulationGrowthPressure
- rankPopulationDeclineRisk
- rankSingleHouseholdRisk
- filterFacilitiesByTypeAndHours
- compareRegions
- nearestFacilityDistance
- countFacilitiesWithinRadius
- getRegionDetails

허용 facilityTypes 목록:
- 종합병원
- 병원
- 요양병원
- 의원
- 치과의원
- 한의원
- 보건소
- 약국

filters 객체의 가능한 키(모두 optional):
- facilityTypes: string[]
- includePharmacy: boolean
- radiusKm: UI와 지도 원이 지원하는 1 이상 3 이하의 숫자
- requireNightHours: boolean
- requireWeekendHours: boolean
- regions: string[]
- compare: string[]
- limit: 1 이상 250 이하의 정수

스키마에 없는 키는 절대 포함하지 마세요. tool 이름은 반드시 허용 목록에 있어야 합니다.

필수 질의 매핑 예시:
- "병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["종합병원","병원","요양병원","의원","치과의원","한의원","보건소"]}}
- "고령" → {"tool":"rankElderlyUnderserved","filters":{}}
- "인구증가" → {"tool":"rankPopulationGrowthPressure","filters":{}}
- "기장군-강서구" → {"tool":"compareRegions","filters":{"compare":["기장군","강서구"]}}
- "2km" → {"tool":"countFacilitiesWithinRadius","filters":{"radiusKm":2}}
- "종합병원" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["종합병원"]}}
- "야간" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"requireNightHours":true}}
- "약국" → {"tool":"filterFacilitiesByTypeAndHours","filters":{"facilityTypes":["약국"]}}

응답은 JSON 객체 하나만 출력하고 마크다운이나 추가 설명을 붙이지 마세요.`;

function buildUserPrompt(query: string): string {
  return `사용자 질의: "${query}"`;
}

async function callAiParser(
  query: string,
  deps: ParseIntentDeps,
  model: string,
): Promise<AnalysisIntent> {
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

  return AnalysisIntentSchema.parse(raw);
}

export async function parseIntentWithFallbacks(
  query: string,
  deps: ParseIntentDeps,
): Promise<ParseIntentResult> {
  const safety = assessQuerySafety(query);

  if (!safety.safe) {
    return {
      intent: null,
      mode: 'demo',
      notice: UNSAFE_QUERY_NOTICE,
    };
  }

  const apiKey = deps.apiKey?.trim();
  const baseUrl = deps.baseUrl?.trim();
  const primaryModel = deps.primaryModel?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = deps.fallbackModel?.trim() || DEFAULT_FALLBACK_MODEL;

  if (!apiKey || !baseUrl) {
    return {
      intent: parseIntentWithRules(safety.query),
      mode: 'demo',
      notice: LOCAL_RULE_NOTICE,
    };
  }

  const attempt = async (model: string): Promise<AnalysisIntent> =>
    callAiParser(safety.query, deps, model);

  for (const model of [primaryModel, primaryModel, fallbackModel]) {
    try {
      const intent = await attempt(model);
      return { intent, mode: 'live' };
    } catch {
      // Continue through the fixed primary, retry, fallback sequence.
    }
  }

  return {
    intent: parseIntentWithRules(safety.query),
    mode: 'demo',
    notice: LOCAL_RULE_NOTICE,
  };
}
