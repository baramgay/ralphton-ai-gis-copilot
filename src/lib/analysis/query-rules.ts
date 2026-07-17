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

const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:km|키로)/gi;

export type QuerySafetyResult =
  | { safe: true; query: string }
  | { safe: false; reason: 'empty' | 'too-long' | 'dangerous-token' | 'radius' };

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

function buildMedicalFacilityFilter(): AnalysisIntent {
  return {
    tool: 'filterFacilitiesByTypeAndHours',
    filters: {
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
  };
}

export function parseIntentWithRules(query: string): AnalysisIntent | null {
  const safety = assessQuerySafety(query);

  if (!safety.safe) {
    return null;
  }

  const normalized = safety.query.toLowerCase();

  if (normalized.includes('약국')) {
    return {
      tool: 'filterFacilitiesByTypeAndHours',
      filters: { facilityTypes: ['약국'] },
    };
  }

  if (normalized.includes('종합병원')) {
    return {
      tool: 'filterFacilitiesByTypeAndHours',
      filters: { facilityTypes: ['종합병원'] },
    };
  }

  if (normalized.includes('야간') || normalized.includes('밤')) {
    return {
      tool: 'filterFacilitiesByTypeAndHours',
      filters: { requireNightHours: true },
    };
  }

  if (normalized === '2km' || normalized.includes('2km') || normalized.includes('2 km')) {
    return {
      tool: 'countFacilitiesWithinRadius',
      filters: { radiusKm: 2 },
    };
  }

  if (normalized.includes('기장') || normalized.includes('강서')) {
    return {
      tool: 'compareRegions',
      filters: { compare: ['기장군', '강서구'] },
    };
  }

  if (normalized.includes('고령') || normalized.includes('노인')) {
    return {
      tool: 'rankElderlyUnderserved',
      filters: {},
    };
  }

  if (normalized.includes('인구증가') || normalized.includes('인구 증가')) {
    return {
      tool: 'rankPopulationGrowthPressure',
      filters: {},
    };
  }

  if (
    normalized.includes('병원') ||
    normalized.includes('의원') ||
    normalized.includes('보건소') ||
    normalized.includes('요양') ||
    normalized.includes('치과') ||
    normalized.includes('한의원')
  ) {
    return buildMedicalFacilityFilter();
  }

  return null;
}

export function validateIntent(value: unknown): AnalysisIntent | null {
  const parsed = AnalysisIntentSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
