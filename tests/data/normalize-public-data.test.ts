import { describe, expect, it } from 'vitest';

import { normalizePublicData } from '@/lib/data/normalize-public-data';

function monthSequence(startYear: number, startMonth: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const absoluteMonth = startYear * 12 + startMonth - 1 + index;
    const year = Math.floor(absoluteMonth / 12);
    const month = (absoluteMonth % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

const months = monthSequence(2025, 5, 14);
const monthToken = (month: string) => month.replace('-', '');

function buildFixture() {
  const residentPopulation = months.flatMap((month) => {
    const row = {
      admmCd: '4812125000',
      admmNm: '경상남도 창원시 테스트동',
      stdgMtrYm: monthToken(month),
      tong: '1',
      ban: '1',
      totNmpr: '100',
      hhCnt: '50',
    };

    return month === months[0] ? [row, { ...row }] : [row];
  });

  const ageSexPopulation = months.flatMap((month) =>
    [
      { age: 10, maleNmpr: 4, femNmpr: 6 },
      { age: 30, maleNmpr: 9, femNmpr: 11 },
      { age: 70, maleNmpr: 14, femNmpr: 16 },
    ].map((values) => ({
      admmCd: '4812125000',
      admmNm: '경상남도 창원시 테스트동',
      stdgMtrYm: monthToken(month),
      tong: '1',
      ban: '1',
      ...values,
    })),
  );

  const onePersonHouseholds = months
    .filter((month) => month !== '2026-05')
    .map((month) => ({
      admmCd: '4812125000',
      admmNm: '경상남도 창원시 테스트동',
      stdgMtrYm: monthToken(month),
      tong: '1',
      ban: '1',
      oneHhCnt: '12',
    }));

  const births = months.map((month) => ({
    admmCd: '4812125000',
    admmNm: '경상남도 창원시 테스트동',
    stdgMtrYm: monthToken(month),
    tong: '1',
    ban: '1',
    brthCnt: '3',
  }));

  const deaths = months.slice(0, -1).map((month) => ({
    admmCd: '4812125000',
    admmNm: '경상남도 창원시 테스트동',
    stdgMtrYm: monthToken(month),
    tong: '1',
    ban: '1',
    dthCnt: '5',
  }));

  return {
    regions: [
      {
        adm_cd2: '4812125000',
        adm_nm: '경상남도 창원시 테스트동',
        representativePoint: { lat: 35.18, lng: 129.08 },
        areaSquareKm: 10,
      },
    ],
    residentPopulation,
    ageSexPopulation,
    onePersonHouseholds,
    births,
    deaths,
    facilities: [
      {
        id: 'hospital-1',
        name: '테스트 종합병원',
        category: '종합병원',
        admmCd: '4812125000',
        admmNm: '경상남도 창원시 테스트동',
        lat: '35.18',
        lng: '129.08',
      },
      {
        id: 'pharmacy-1',
        name: '테스트 약국',
        category: '약국',
        admmCd: '4812125000',
        admmNm: '경상남도 창원시 테스트동',
        lat: '35.19',
        lng: '129.09',
        hours: { mon: '09:00-18:00' },
      },
    ],
  };
}

describe('normalizePublicData', () => {
  it('dedupes tong/ban, selects the latest common 13-month window, and preserves nulls', () => {
    const snapshot = normalizePublicData(buildFixture());
    const region = snapshot.regions[0];

    expect(snapshot.mode).toBe('live');
    expect(snapshot.referenceMonth).toBe('2026-05');
    expect(snapshot.months).toHaveLength(13);
    expect(snapshot.months[0]).toBe('2025-05');
    expect(snapshot.months.at(-1)).toBe('2026-05');
    expect(region.population).toEqual(Array(13).fill(100));
    expect(region.households).toEqual(Array(13).fill(50));
    expect(region.populationDensity).toEqual(Array(13).fill(10));
    expect(region.youthPopulation).toEqual(Array(13).fill(10));
    expect(region.workingAgePopulation).toEqual(Array(13).fill(20));
    expect(region.elderlyPopulation).toEqual(Array(13).fill(30));
    expect(region.onePersonHouseholds.at(-1)).toBeNull();
    expect(region.births).toEqual(Array(13).fill(3));
    expect(region.deaths).toEqual(Array(13).fill(5));
    expect(region.naturalChange).toEqual(Array(13).fill(-2));
  });

  it('keeps pharmacies separate and does not invent missing specialty or hours data', () => {
    const snapshot = normalizePublicData(buildFixture());
    const hospital = snapshot.facilities.find((facility) => facility.id === 'hospital-1');
    const pharmacy = snapshot.facilities.find((facility) => facility.id === 'pharmacy-1');

    expect(hospital).toMatchObject({
      type: '종합병원',
      specialties: null,
      hours: null,
    });
    expect(pharmacy).toMatchObject({
      type: '약국',
      specialties: null,
      hours: { mon: '09:00-18:00' },
    });
  });

  it('rejects a required dataset row with missing columns', () => {
    const fixture = buildFixture();
    fixture.residentPopulation[0] = {
      ...fixture.residentPopulation[0],
      hhCnt: undefined as unknown as string,
    };

    expect(() => normalizePublicData(fixture)).toThrow();
  });
});
