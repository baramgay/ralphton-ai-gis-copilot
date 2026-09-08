import { describe, expect, it } from 'vitest';

import { AnalysisIntentSchema } from '@/lib/analysis/intent-schema';
import { parseIntentWithRules, resolveQueryWithRules } from '@/lib/analysis/query-rules';
import { NL_LAYERS } from '@/lib/layers/catalog';
import { resolveLayerQuery } from '@/lib/layers/resolve-layer-query';

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
      { tool: 'compareRegions', filters: { compare: ['창원시', '김해시'] } },
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
    ['창원 vs 김해', { tool: 'compareRegions', filters: { compare: ['창원시', '김해시'] } }],
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

describe('resolveQueryWithRules 사람 흐름', () => {
  /*
   * 출발·도착 상대 지역을 묻는 말은 총량 순위로 답하면 안 된다 — 상대 지역은 시군구
   * 흐름 자료에만 있다. 지역 1곳이 정해지면 그 지역 상세로 가서 사람 흐름 패널을 보여 준다.
   */
  it.each([
    ['김해 사람들 어디서 와?', '김해시'],
    ['양산으로 오는 사람은 어디서 와?', '양산시'],
  ])('routes "%s" to region details', (query, region) => {
    const resolved = resolveQueryWithRules(query);
    expect(resolved.kind).toBe('intent');
    if (resolved.kind !== 'intent') return;
    expect(resolved.intent.tool).toBe('getRegionDetails');
    expect(resolved.intent.filters.regions).toEqual([region]);
    expect(resolved.notice).toContain('사람 흐름');
  });

  it('routes a dong flow query to the dong code', () => {
    const resolved = resolveQueryWithRules('물금읍 사람들 어디서 와?');
    expect(resolved.kind).toBe('intent');
    if (resolved.kind !== 'intent') return;
    expect(resolved.intent.tool).toBe('getRegionDetails');
    expect(resolved.intent.filters.regions?.[0]).toMatch(/^\d{10}$/);
  });

  it('does not hijack inflow-total queries', () => {
    // "외지에서 많이 들어오는 곳"에는 흐름 단서가 없다 — 기존 동작 그대로 둔다.
    const resolved = resolveQueryWithRules('외지에서 많이 들어오는 곳');
    expect(resolved.kind).toBe('unsupported');
  });

  it('does not hijack inflow ranking queries', () => {
    const resolved = resolveQueryWithRules('유입인구 많은 동');
    expect(resolved.kind).toBe('intent');
    if (resolved.kind !== 'intent') return;
    expect(resolved.intent.tool).toBe('rankPopulationGrowthPressure');
  });

  it('lets compare win over flow wording', () => {
    const resolved = resolveQueryWithRules('창원 vs 김해 어디서 많이 와?');
    expect(resolved.kind).toBe('intent');
    if (resolved.kind !== 'intent') return;
    expect(resolved.intent.tool).toBe('compareRegions');
  });
});

describe('resolveQueryWithRules 돈 흐름', () => {
  /*
   * 카드매출이 어디서 와서 쓰이는지를 묻는 말은 총액 순위로 답하면 안 된다.
   * 「돈」 말에는 레이어 트리거가 없어서 여기까지 온다(「매출」「소비」는
   * 클라이언트에서 먼저 잡히므로 이 분기에 닿지 않는다).
   */
  it.each([
    ['김해 돈은 어디서 와?', '김해시'],
    ['양산 돈이 어디서 와?', '양산시'],
  ])('routes "%s" to region details', (query, region) => {
    const resolved = resolveQueryWithRules(query);
    expect(resolved.kind).toBe('intent');
    if (resolved.kind !== 'intent') return;
    expect(resolved.intent.tool).toBe('getRegionDetails');
    expect(resolved.intent.filters.regions).toEqual([region]);
    expect(resolved.notice).toContain('돈 흐름');
  });

  it('does not hijack inflow ranking queries', () => {
    // 「카드매출 많은 동」은 규칙 카탈로그에 카드 도구가 없어 unsupported다.
    // 실제 화면에서는 클라이언트 레이어 경로가 먼저 잡는다. 여기서 중요한 것은
    // 돈 분기가 가로채지 않는 것뿐이다.
    const resolved = resolveQueryWithRules('카드매출 많은 동');
    expect(resolved.kind).toBe('unsupported');
  });

  it('says honestly that outbound money data does not exist', () => {
    const resolved = resolveQueryWithRules('김해 돈이 어디로 가?');
    expect(resolved.kind).toBe('unsupported');
    if (resolved.kind !== 'unsupported') return;
    expect(resolved.notice).toContain('나가는 돈');
  });

  it('client layer resolvers do not grab money-origin wording first', () => {
    // 서버 규칙 분기까지 닿아야 한다. 레이어 트리거에 걸리면 총액 순위로 간다.
    expect(resolveLayerQuery('김해 돈은 어디서 와?', NL_LAYERS)).toBeNull();
    expect(resolveLayerQuery('양산 돈이 어디서 와?', NL_LAYERS)).toBeNull();
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
