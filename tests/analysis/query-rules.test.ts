import { describe, expect, it } from 'vitest';

import { AnalysisIntentSchema } from '@/lib/analysis/intent-schema';
import { parseIntentWithRules } from '@/lib/analysis/query-rules';

describe('parseIntentWithRules', () => {
  it.each([
    [
      '병원',
      {
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
      },
    ],
    ['고령 의료 부족', { tool: 'rankElderlyUnderserved' }],
    ['고령화율 높은 동', { tool: 'rankElderlyRatio' }],
    ['인구증가', { tool: 'rankPopulationGrowthPressure' }],
    [
      '창원과 김해 비교',
      { tool: 'compareRegions', filters: { compare: ['창원시 의창구', '김해시'] } },
    ],
    ['2km', { tool: 'countFacilitiesWithinRadius', filters: { radiusKm: 2 } }],
    [
      '종합병원',
      {
        tool: 'filterFacilitiesByTypeAndHours',
        filters: { facilityTypes: ['종합병원'] },
      },
    ],
    [
      '야간',
      {
        tool: 'filterFacilitiesByTypeAndHours',
        filters: { requireNightHours: true },
      },
    ],
    [
      '약국',
      {
        tool: 'filterFacilitiesByTypeAndHours',
        filters: { facilityTypes: ['약국'] },
      },
    ],
    ['의료 취약 지역', { tool: 'rankHospitalScarcity' }],
    ['1인가구 많은 동', { tool: 'rankSingleHouseholdRisk' }],
    ['김해시 상세', { tool: 'getRegionDetails', filters: { regions: ['김해시'] } }],
    ['사망자 많은 곳', { tool: 'rankDeathCount' }],
    ['출생이 많은 지역', { tool: 'rankBirthCount' }],
    ['자연감소가 큰 곳', { tool: 'rankNaturalDecrease' }],
    ['어디가 제일 의료 취약해', { tool: 'rankHospitalScarcity' }],
    ['진주시 어때', { tool: 'getRegionDetails', filters: { regions: ['진주시'] } }],
    ['김해 근처 병원', { tool: 'filterFacilitiesByTypeAndHours' }],
    ['창원 vs 김해', { tool: 'compareRegions', filters: { compare: ['창원시 의창구', '김해시'] } }],
    ['2키로 안 병원 적은 동', { tool: 'countFacilitiesWithinRadius', filters: { radiusKm: 2 } }],
    ['인구 많은 동', { tool: 'rankPopulationSize' }],
    ['치과 보여줘', { tool: 'filterFacilitiesByTypeAndHours', filters: { facilityTypes: ['치과의원'] } }],
    ['병원까지 먼 곳', { tool: 'nearestFacilityDistance' }],
  ])('parses "%s" to the expected intent', (query, expected) => {
    const intent = parseIntentWithRules(query);

    expect(intent).toMatchObject(expected);
    expect(() => AnalysisIntentSchema.parse(intent)).not.toThrow();
  });

  it('returns null for an empty query', () => {
    expect(parseIntentWithRules('')).toBeNull();
  });

  it('returns null for a whitespace-only query', () => {
    expect(parseIntentWithRules('   \t\n')).toBeNull();
  });

  it('rejects queries exceeding 1000 characters', () => {
    const longQuery = '병원'.repeat(501);

    expect(longQuery.length).toBeGreaterThan(1000);
    expect(parseIntentWithRules(longQuery)).toBeNull();
  });

  it('rejects queries containing shell keyword', () => {
    expect(parseIntentWithRules('tool:shell')).toBeNull();
    expect(parseIntentWithRules('execute shell command')).toBeNull();
  });

  it('rejects queries containing sql keyword', () => {
    expect(parseIntentWithRules('select * from users')).toBeNull();
    expect(parseIntentWithRules('drop table facilities')).toBeNull();
  });

  it('rejects queries containing eval or exec', () => {
    expect(parseIntentWithRules('eval(document.cookie)')).toBeNull();
    expect(parseIntentWithRules('exec rm -rf /')).toBeNull();
  });

  it('rejects queries with suspicious punctuation', () => {
    expect(parseIntentWithRules('병원; drop')).toBeNull();
    expect(parseIntentWithRules('병원 `whoami`')).toBeNull();
  });

  it('rejects every unreasonable radius even when a safe radius appears first', () => {
    expect(parseIntentWithRules('2km와 50km 병원을 비교해줘')).toBeNull();
  });

  it('returns null for an unrelated query', () => {
    expect(parseIntentWithRules('오늘 날씨 어때?')).toBeNull();
  });
});

describe('AnalysisIntentSchema attack boundaries', () => {
  it('allows the full 511-dong analysis while bounding oversized result requests', () => {
    expect(
      AnalysisIntentSchema.safeParse({
        tool: 'rankHospitalScarcity',
        filters: { limit: 511 },
      }).success,
    ).toBe(true);
    expect(
      AnalysisIntentSchema.safeParse({
        tool: 'rankHospitalScarcity',
        filters: { limit: 601 },
      }).success,
    ).toBe(false);
  });

  it.each([1, 2, 3])('accepts a UI-supported %skm radius', (radiusKm) => {
    expect(
      AnalysisIntentSchema.safeParse({
        tool: 'countFacilitiesWithinRadius',
        filters: { radiusKm },
      }).success,
    ).toBe(true);
  });

  it.each([0, 4, 5])('rejects a UI-unsupported %skm radius', (radiusKm) => {
    expect(
      AnalysisIntentSchema.safeParse({
        tool: 'countFacilitiesWithinRadius',
        filters: { radiusKm },
      }).success,
    ).toBe(false);
  });

  it.each([
    { tool: 'shell', filters: {} },
    { tool: 'rankHospitalScarcity', filters: {}, sql: 'select * from facilities' },
    { tool: 'rankHospitalScarcity', filters: {}, unexpected: true },
    { tool: 'countFacilitiesWithinRadius', filters: { radiusKm: 50 } },
    {
      tool: 'rankHospitalScarcity',
      filters: { unexpected: true },
    },
  ])('rejects a forbidden intent shape', (value) => {
    expect(AnalysisIntentSchema.safeParse(value).success).toBe(false);
  });
});
