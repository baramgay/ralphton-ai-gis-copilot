import { AnalysisIntentSchema, type AnalysisIntent } from './intent-schema';

export const MAX_QUERY_LENGTH = 1000;

const DANGEROUS_KEYWORDS = [
  'shell',
  'sql',
  'select',
  'insert',
  'update',
  'delete',
  'drop',
  'exec',
  'eval',
  'bash',
  'cmd',
  'powershell',
];

const SUSPICIOUS_PUNCTUATION = /[;`{}]|\/\//;

const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:km|키로|킬로)/gi;

/** Common Busan district labels used for compare / details without loading GeoJSON. */
export const BUSAN_DISTRICT_LABELS = [
  '중구',
  '서구',
  '동구',
  '영도구',
  '부산진구',
  '동래구',
  '남구',
  '북구',
  '해운대구',
  '사하구',
  '금정구',
  '강서구',
  '연제구',
  '수영구',
  '사상구',
  '기장군',
] as const;

export const QUERY_SUGGESTIONS = [
  '고령 인구 대비 병원이 부족한 곳',
  '의료 취약 지역 순위',
  '최근접 의료기관 거리가 먼 동',
  '2km 안에 병원이 적은 곳',
  '기장군과 강서구 비교',
  '해운대구 상세 지표',
  '종합병원 위치',
  '약국만 보여줘',
  '인구가 늘어나는 지역',
  '1인가구 비중이 높은 동',
] as const;

export type QuerySafetyResult =
  | { safe: true; query: string }
  | { safe: false; reason: 'empty' | 'too-long' | 'dangerous-token' | 'radius' };

export type SafetyReason = 'empty' | 'too-long' | 'dangerous-token' | 'radius';

export type RuleParseResult =
  | {
      kind: 'intent';
      intent: AnalysisIntent;
      notice: string;
    }
  | {
      kind: 'unsupported';
      intent: null;
      notice: string;
      suggestions: string[];
    }
  | {
      kind: 'unsafe';
      intent: null;
      notice: string;
      reason: SafetyReason;
    };

export function assessQuerySafety(query: string): QuerySafetyResult {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return { safe: false, reason: 'empty' };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return { safe: false, reason: 'too-long' };
  }

  const lower = trimmed.toLowerCase();

  if (DANGEROUS_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return { safe: false, reason: 'dangerous-token' };
  }

  if (SUSPICIOUS_PUNCTUATION.test(trimmed)) {
    return { safe: false, reason: 'dangerous-token' };
  }

  for (const radiusMatch of trimmed.matchAll(RADIUS_PATTERN)) {
    const radius = Number.parseFloat(radiusMatch[1]);

    if (Number.isFinite(radius) && (radius < 1 || radius > 3)) {
      return { safe: false, reason: 'radius' };
    }
  }

  return { safe: true, query: trimmed };
}

function safetyNotice(reason: SafetyReason): string {
  switch (reason) {
    case 'empty':
      return '질문을 입력해 주세요. 예: 고령 인구 대비 병원이 부족한 곳';
    case 'too-long':
      return '질문이 너무 깁니다. 핵심만 짧게 다시 적어 주세요.';
    case 'radius':
      return '접근 반경은 1·2·3km만 분석할 수 있습니다. 예: 2km 안에 병원이 적은 곳';
    case 'dangerous-token':
    default:
      return '보안상 처리할 수 없는 표현이 포함되어 있습니다. 일반 분석 질문으로 다시 물어봐 주세요.';
  }
}

function buildMedicalFacilityFilter(types?: AnalysisIntent['filters']['facilityTypes']): AnalysisIntent {
  return {
    tool: 'filterFacilitiesByTypeAndHours',
    filters: {
      facilityTypes: types ?? [
        '종합병원',
        '병원',
        '요양병원',
        '의원',
        '치과의원',
        '한의원',
        '보건소',
      ],
    },
  };
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractRadiusKm(text: string): 1 | 2 | 3 | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:km|키로|킬로)/i);
  if (!match) {
    if (includesAny(text, ['반경', '접근성', '인근', '주변']) && includesAny(text, ['병원', '의료', '의원'])) {
      return 2;
    }
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return null;
}

function extractDistricts(text: string): string[] {
  // Longer labels first so "강서구" wins over nested "서구".
  const labels = [...BUSAN_DISTRICT_LABELS].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let remaining = text;

  for (const label of labels) {
    if (!remaining.includes(label)) continue;
    found.push(label);
    remaining = remaining.split(label).join(" ");
  }

  // Keep original appearance order for stable compare UX.
  return found.sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

function withLimit(intent: AnalysisIntent, limit = 20): AnalysisIntent {
  return {
    ...intent,
    filters: {
      ...intent.filters,
      limit: intent.filters.limit ?? limit,
    },
  };
}

/**
 * Deterministic Korean intent parser covering everyday policy/demo questions.
 * Prefer this offline path when Qwen is unavailable; still useful as validation fallback.
 */
export function resolveQueryWithRules(query: string): RuleParseResult {
  const safety = assessQuerySafety(query);

  if (!safety.safe) {
    return {
      kind: 'unsafe',
      intent: null,
      notice: safetyNotice(safety.reason),
      reason: safety.reason,
    };
  }

  const raw = safety.query;
  const text = raw.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const districts = extractDistricts(text);
  const radiusKm = extractRadiusKm(lower);

  // --- facility type filters (specific first) ---
  if (includesAny(text, ['약국', '약방'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['약국']),
      notice: '약국 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['종합병원', '대학병원', '상급종합'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['종합병원']),
      notice: '종합병원 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['치과의원', '치과'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['치과의원']),
      notice: '치과의원 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['한의원', '한방'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['한의원']),
      notice: '한의원 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['요양병원', '요양'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['요양병원']),
      notice: '요양병원 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['보건소', '보건지소'])) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(['보건소']),
      notice: '보건소 위치를 지도에 표시했습니다.',
    };
  }

  if (includesAny(text, ['야간', '밤', '심야', '저녁 진료', '야간진료'])) {
    return {
      kind: 'intent',
      intent: {
        tool: 'filterFacilitiesByTypeAndHours',
        filters: {
          requireNightHours: true,
          facilityTypes: [
            '종합병원',
            '병원',
            '요양병원',
            '의원',
            '치과의원',
            '한의원',
            '보건소',
          ],
        },
      },
      notice: '야간 운영 정보가 있는 의료기관만 추렸습니다. 값이 없는 시설은 제외됩니다.',
    };
  }

  if (includesAny(text, ['주말', '토요일', '일요일', '주말진료'])) {
    return {
      kind: 'intent',
      intent: {
        tool: 'filterFacilitiesByTypeAndHours',
        filters: {
          requireWeekendHours: true,
          facilityTypes: [
            '종합병원',
            '병원',
            '요양병원',
            '의원',
            '치과의원',
            '한의원',
            '보건소',
          ],
        },
      },
      notice: '주말 운영 정보가 있는 의료기관만 추렸습니다. 값이 없는 시설은 제외됩니다.',
    };
  }

  // --- radius access ---
  if (radiusKm !== null || includesAny(text, ['2km', '2 km', '1km', '3km', '반경', '접근성'])) {
    const resolved = radiusKm ?? 2;
    return {
      kind: 'intent',
      intent: withLimit({
        tool: 'countFacilitiesWithinRadius',
        filters: { radiusKm: resolved },
      }),
      notice: `대표점 기준 ${resolved}km 반경 의료기관 수를 비교했습니다.`,
    };
  }

  // --- comparisons ---
  if (districts.length >= 2 || includesAny(text, ['비교', 'vs', '대비', '와 비교', '랑 비교'])) {
    const compare =
      districts.length >= 2
        ? districts.slice(0, 2)
        : includesAny(text, ['기장']) || includesAny(text, ['강서'])
          ? ['기장군', '강서구']
          : districts.length === 1
            ? null
            : ['기장군', '강서구'];

    if (compare) {
      return {
        kind: 'intent',
        intent: {
          tool: 'compareRegions',
          filters: { compare },
        },
        notice: `${compare.join(' · ')} 관련 행정동 지표를 나란히 비교합니다.`,
      };
    }
  }

  // --- ranking tools ---
  if (
    includesAny(text, [
      '고령',
      '노인',
      '노령',
      '어르신',
      '65세',
      '초고령',
      '고령화',
    ])
  ) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankElderlyUnderserved', filters: {} }),
      notice: '고령 수요 대비 의료 공급이 약한 행정동 순으로 정렬했습니다.',
    };
  }

  if (
    includesAny(text, [
      '인구증가',
      '인구 증가',
      '늘어나는',
      '증가하는 인구',
      '인구가 늘',
      '유입',
      '성장 압력',
      '공급 부족',
    ]) &&
    !includesAny(text, ['감소', '줄어', '축소', '유출'])
  ) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankPopulationGrowthPressure', filters: {} }),
      notice: '인구 증가 압력과 의료 공급 부담을 함께 본 순위입니다.',
    };
  }

  if (
    includesAny(text, [
      '인구감소',
      '인구 감소',
      '줄어드는',
      '감소하는 인구',
      '인구가 줄',
      '축소',
      '유출',
      '소멸',
    ])
  ) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankPopulationDeclineRisk', filters: {} }),
      notice: '인구 감소 위험이 큰 행정동 순으로 정렬했습니다.',
    };
  }

  if (includesAny(text, ['1인가구', '1인 가구', '단독가구', '혼자 사는', '단독세대'])) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankSingleHouseholdRisk', filters: {} }),
      notice: '1인가구 비중이 높은 행정동 순입니다. 값이 없는 동은 순위에서 제외합니다.',
    };
  }

  if (
    includesAny(text, [
      '취약',
      '부족한',
      '부족',
      '의료 공백',
      '의료공백',
      '사각',
      '취약지수',
      '의료취약',
      '병원이 없',
      '의원이 없',
    ])
  ) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankHospitalScarcity', filters: {} }),
      notice: '의료 취약지수가 높은 행정동 순으로 정렬했습니다.',
    };
  }

  if (
    includesAny(text, [
      '최근접',
      '가까운 병원',
      '먼 병원',
      '거리',
      '얼마나 멀',
      '직선거리',
      '접근 거리',
      '원거리',
    ])
  ) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'nearestFacilityDistance', filters: {} }),
      notice: '행정동 대표점 기준 최근접 의료기관 직선거리를 계산했습니다.',
    };
  }

  // --- region details ---
  if (districts.length === 1 || includesAny(text, ['상세', '자세히', '알려줘', '현황', '지표'])) {
    if (districts.length >= 1) {
      return {
        kind: 'intent',
        intent: {
          tool: 'getRegionDetails',
          filters: { regions: [districts[0]] },
        },
        notice: `${districts[0]} 관련 행정동 상세 지표를 불러왔습니다.`,
      };
    }
  }

  // general hospital listing
  if (
    includesAny(text, ['병원', '의원', '의료기관', '클리닉', '진료소', '의료시설', '시설 목록', '위치'])
  ) {
    return {
      kind: 'intent',
      intent: buildMedicalFacilityFilter(),
      notice: '약국을 제외한 의료기관을 지도에 표시했습니다.',
    };
  }

  // soft default: medical + population words → scarcity ranking (most useful demo default)
  if (includesAny(text, ['인구', '의료', '건강', '돌봄', '복지', '행정동', '부산'])) {
    return {
      kind: 'intent',
      intent: withLimit({ tool: 'rankHospitalScarcity', filters: {} }),
      notice: '관련 키워드를 의료 취약 지역 분석으로 해석했습니다.',
    };
  }

  return {
    kind: 'unsupported',
    intent: null,
    notice:
      '이 질문은 현재 지도 분석 범위(의료·인구 접근성) 밖이거나, 보유 데이터로 바로 답하기 어렵습니다. 아래 예시처럼 물어보시면 바로 분석할 수 있습니다.',
    suggestions: [...QUERY_SUGGESTIONS],
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
