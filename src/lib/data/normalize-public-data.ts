import { z } from 'zod';

import {
  aggregateTongBanRows,
  calculateNaturalChange,
  type AggregatedRow,
  type TongBanRow,
} from '@/lib/domain/aggregation';
import { selectLatestCommonMonth } from '@/lib/domain/periods';
import {
  FacilitySchema,
  MonthSchema,
  RegionSeriesSchema,
  type DemoSnapshot,
  type Facility,
  type RegionSeries,
} from '@/lib/domain/schemas';
import { parsePublicDataPage } from './public-api';

const JsonRecordSchema = z.record(z.string(), z.unknown());

const RegionBaseSchema = z.object({
  adm_cd2: z.string().regex(/^\d{10}$/),
  adm_nm: z.string().min(1),
  representativePoint: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  areaSquareKm: z.number().positive(),
});

export type LiveSnapshot = Omit<DemoSnapshot, 'mode'> & { mode: 'live' };
export type PublicRegionBase = z.infer<typeof RegionBaseSchema>;

export interface NormalizePublicDataInput {
  regions: PublicRegionBase[];
  residentPopulation: unknown;
  ageSexPopulation: unknown;
  onePersonHouseholds?: unknown;
  births: unknown;
  deaths: unknown;
  facilities?: unknown;
  sourceNotes?: string[];
}

export class PublicDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicDataValidationError';
  }
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const parsed = z.array(JsonRecordSchema).safeParse(value);

    if (parsed.success) {
      return parsed.data;
    }
  }

  const pageRecord = JsonRecordSchema.safeParse(value);

  if (pageRecord.success && Array.isArray(pageRecord.data.items)) {
    const parsed = z.array(JsonRecordSchema).safeParse(pageRecord.data.items);

    if (parsed.success) {
      return parsed.data;
    }
  }

  try {
    return parsePublicDataPage(value).items;
  } catch {
    throw new PublicDataValidationError('공공데이터 행 형식이 올바르지 않습니다.');
  }
}

function firstValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }

  return undefined;
}

function requiredString(
  row: Record<string, unknown>,
  keys: string[],
  label: string,
): string {
  const value = firstValue(row, keys);

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new PublicDataValidationError(`${label} 열이 없습니다.`);
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new PublicDataValidationError(`${label} 열이 비어 있습니다.`);
  }

  return normalized;
}

function optionalNumber(row: Record<string, unknown>, keys: string[]): number | null {
  const value = firstValue(row, keys);

  if (value === undefined) {
    return null;
  }

  const normalized = typeof value === 'string' ? value.replaceAll(',', '').trim() : value;
  const number = typeof normalized === 'number' ? normalized : Number(normalized);

  if (!Number.isFinite(number) || number < 0) {
    throw new PublicDataValidationError(`${keys[0]} 값이 올바르지 않습니다.`);
  }

  return number;
}

function requiredNumber(row: Record<string, unknown>, keys: string[], label: string): number {
  const value = optionalNumber(row, keys);

  if (value === null) {
    throw new PublicDataValidationError(`${label} 열이 없습니다.`);
  }

  return value;
}

function normalizeMonth(value: string): string {
  const digits = value.replace('-', '');

  if (!/^\d{6}$/.test(digits)) {
    throw new PublicDataValidationError('기준월 형식이 올바르지 않습니다.');
  }

  return MonthSchema.parse(`${digits.slice(0, 4)}-${digits.slice(4)}`);
}

interface CommonRow {
  adm_cd2: string;
  adm_nm: string;
  month: string;
  tong: string;
  ban: string;
}

function normalizeCommonRow(row: Record<string, unknown>): CommonRow {
  const adm_cd2 = requiredString(
    row,
    ['adm_cd2', 'admCd2', 'admmCd', 'stdgCd'],
    '행정동 코드',
  );

  if (!/^\d{10}$/.test(adm_cd2)) {
    throw new PublicDataValidationError('행정동 코드는 10자리여야 합니다.');
  }

  return {
    adm_cd2,
    adm_nm: requiredString(row, ['adm_nm', 'admNm', 'admmNm', 'stdgNm'], '행정동 이름'),
    month: normalizeMonth(
      requiredString(row, ['month', 'stdgMtrYm', 'baseYm', 'statsYm'], '기준월'),
    ),
    tong: String(firstValue(row, ['tong', 'tongNm', 'tongNo']) ?? ''),
    ban: String(firstValue(row, ['ban', 'banNm', 'banNo']) ?? ''),
  };
}

function groupAndAggregate(rows: TongBanRow[]): Map<string, AggregatedRow> {
  const groups = new Map<string, TongBanRow[]>();

  for (const row of rows) {
    const key = `${row.adm_cd2}|${row.month}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return new Map(
    [...groups].map(([key, group]) => [key, aggregateTongBanRows(group)]),
  );
}

function baseTongBan(common: CommonRow): TongBanRow {
  return {
    adm_cd2: common.adm_cd2,
    month: common.month,
    tong: common.tong,
    ban: common.ban,
    population: 0,
    households: 0,
  };
}

function normalizeResidentRows(value: unknown): Map<string, AggregatedRow> {
  return groupAndAggregate(
    asRows(value).map((row) => {
      const common = normalizeCommonRow(row);
      return {
        ...baseTongBan(common),
        population: requiredNumber(
          row,
          ['population', 'totNmpr', 'totPpltn', 'ppltnCnt'],
          '총인구',
        ),
        households: requiredNumber(
          row,
          ['households', 'hhCnt', 'totHh', 'totHshld', 'hhldCnt'],
          '세대수',
        ),
      };
    }),
  );
}

function longAgePopulation(row: Record<string, unknown>): {
  age: number;
  male: number;
  female: number;
} | null {
  const age = optionalNumber(row, ['age', 'ageValue', 'ageCd']);

  if (age === null) {
    return null;
  }

  return {
    age,
    male: requiredNumber(row, ['malePopulation', 'maleNmpr', 'maleCnt'], '남성 인구'),
    female: requiredNumber(row, ['femalePopulation', 'femNmpr', 'femaleCnt'], '여성 인구'),
  };
}

function wideAgeTotals(row: Record<string, unknown>): Map<number, number> {
  const totals = new Map<number, number>();

  for (const [key, rawValue] of Object.entries(row)) {
    const match = /^(?:male|fem|female)(\d+)(?:Age)?(?:Nmpr|Ppltn|Cnt)$/i.exec(key);

    if (!match) {
      continue;
    }

    const value = optionalNumber({ value: rawValue }, ['value']);

    if (value !== null) {
      const age = Number(match[1]);
      totals.set(age, (totals.get(age) ?? 0) + value);
    }
  }

  return totals;
}

function normalizeAgeRows(value: unknown): Map<string, AggregatedRow> {
  const normalized: TongBanRow[] = [];

  for (const row of asRows(value)) {
    const common = normalizeCommonRow(row);
    const long = longAgePopulation(row);
    const ageTotals = long
      ? new Map([[long.age, long.male + long.female]])
      : wideAgeTotals(row);

    if (ageTotals.size === 0) {
      throw new PublicDataValidationError('성·연령 인구 열이 없습니다.');
    }

    for (const [age, population] of ageTotals) {
      normalized.push({
        ...baseTongBan(common),
        ban: `${common.ban}|age:${age}`,
        youthPopulation: age <= 14 ? population : 0,
        workingAgePopulation: age >= 15 && age <= 64 ? population : 0,
        elderlyPopulation: age >= 65 ? population : 0,
      });
    }
  }

  return groupAndAggregate(normalized);
}

function normalizeOnePersonRows(value: unknown): Map<string, AggregatedRow> {
  const normalized: TongBanRow[] = [];

  for (const row of asRows(value)) {
    const common = normalizeCommonRow(row);
    const direct = optionalNumber(
      row,
      ['onePersonHouseholds', 'oneHhCnt', 'totOneHh', 'oneHhldCnt'],
    );
    const long = longAgePopulation(row);
    const wide = wideAgeTotals(row);
    const derived = long
      ? long.male + long.female
      : wide.size > 0
        ? [...wide.values()].reduce((sum, count) => sum + count, 0)
        : null;

    normalized.push({
      ...baseTongBan(common),
      onePersonHouseholds: direct ?? derived,
    });
  }

  return groupAndAggregate(normalized);
}

function normalizeCountRows(
  value: unknown,
  field: 'births' | 'deaths',
): Map<string, AggregatedRow> {
  const aliases =
    field === 'births'
      ? ['births', 'brthCnt', 'brthRegistCnt', 'totBrth']
      : ['deaths', 'dthCnt', 'dthRegistCnt', 'totDth'];

  return groupAndAggregate(
    asRows(value).map((row) => {
      const common = normalizeCommonRow(row);
      return {
        ...baseTongBan(common),
        [field]: requiredNumber(row, aliases, field === 'births' ? '출생' : '사망'),
      };
    }),
  );
}

function monthsIn(map: Map<string, AggregatedRow>): string[] {
  return [...new Set([...map.keys()].map((key) => key.split('|')[1]))].sort();
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function selectThirteenMonths(maps: Array<Map<string, AggregatedRow>>): string[] {
  const monthArrays = maps.map(monthsIn);
  const latest = selectLatestCommonMonth(monthArrays);

  if (!latest) {
    throw new PublicDataValidationError('필수 데이터셋의 공통 기준월이 없습니다.');
  }

  const common = monthArrays[0]
    .filter((month) => month <= latest && monthArrays.slice(1).every((set) => set.includes(month)))
    .sort()
    .slice(-13);

  if (common.length !== 13) {
    throw new PublicDataValidationError('최근 13개월의 공통 데이터가 필요합니다.');
  }

  for (let index = 1; index < common.length; index += 1) {
    if (previousMonth(common[index]) !== common[index - 1]) {
      throw new PublicDataValidationError('공통 데이터의 월이 연속적이지 않습니다.');
    }
  }

  return common;
}

function requiredAggregate(
  map: Map<string, AggregatedRow>,
  admCd2: string,
  month: string,
  dataset: string,
): AggregatedRow {
  const row = map.get(`${admCd2}|${month}`);

  if (!row) {
    throw new PublicDataValidationError(`${dataset} 데이터가 누락되었습니다.`);
  }

  return row;
}

function normalizeFacilityType(value: string): Facility['type'] {
  const types: Facility['type'][] = [
    '약국',
    '요양병원',
    '종합병원',
    '치과의원',
    '한의원',
    '의원',
    '보건소',
    '병원',
  ];
  const matched = types.find((type) => value.includes(type));

  if (!matched) {
    throw new PublicDataValidationError('지원하지 않는 시설 분류입니다.');
  }

  return matched;
}

function normalizeSpecialties(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const specialties = value.map(String).map((item) => item.trim()).filter(Boolean);
    return specialties.length > 0 ? specialties : null;
  }

  if (typeof value === 'string') {
    const specialties = value.split(',').map((item) => item.trim()).filter(Boolean);
    return specialties.length > 0 ? specialties : null;
  }

  return null;
}

function normalizeHours(value: unknown): Record<string, string | null> | null {
  const record = JsonRecordSchema.safeParse(value);

  if (!record.success) {
    return null;
  }

  const hours: Record<string, string | null> = {};

  for (const [day, rawValue] of Object.entries(record.data)) {
    if (typeof rawValue === 'string' || rawValue === null) {
      hours[day] = rawValue;
    }
  }

  return Object.keys(hours).length > 0 ? hours : null;
}

function normalizeFacilities(value: unknown): Facility[] {
  if (value === undefined) {
    return [];
  }

  return asRows(value).map((row) =>
    FacilitySchema.parse({
      id: requiredString(row, ['id', 'facilityId', 'ykiho'], '시설 ID'),
      name: requiredString(row, ['name', 'facilityName', 'yadmNm'], '시설명'),
      type: normalizeFacilityType(
        requiredString(row, ['type', 'category', 'facilityType', 'clCdNm'], '시설 분류'),
      ),
      adm_cd2: requiredString(row, ['adm_cd2', 'admCd2', 'admmCd'], '행정동 코드'),
      adm_nm: requiredString(row, ['adm_nm', 'admNm', 'admmNm'], '행정동 이름'),
      lat: requiredNumber(row, ['lat', 'latitude', 'YPos'], '위도'),
      lng: requiredNumber(row, ['lng', 'longitude', 'XPos'], '경도'),
      specialties: normalizeSpecialties(
        firstValue(row, ['specialties', 'departments', 'dgsbjtCdNm']),
      ),
      hours: normalizeHours(firstValue(row, ['hours', 'openingHours'])),
      address: firstValue(row, ['address', 'addr']) ?? null,
      phone: firstValue(row, ['phone', 'telno']) ?? null,
    }),
  );
}

export function normalizePublicData(input: NormalizePublicDataInput): LiveSnapshot {
  const regions = z.array(RegionBaseSchema).min(1).parse(input.regions);
  const resident = normalizeResidentRows(input.residentPopulation);
  const ages = normalizeAgeRows(input.ageSexPopulation);
  const onePerson =
    input.onePersonHouseholds === undefined
      ? new Map<string, AggregatedRow>()
      : normalizeOnePersonRows(input.onePersonHouseholds);
  const births = normalizeCountRows(input.births, 'births');
  const deaths = normalizeCountRows(input.deaths, 'deaths');
  const months = selectThirteenMonths([resident, ages, births, deaths]);

  const normalizedRegions: RegionSeries[] = regions.map((region) => {
    const residentRows = months.map((month) =>
      requiredAggregate(resident, region.adm_cd2, month, '인구·세대'),
    );
    const ageRows = months.map((month) =>
      requiredAggregate(ages, region.adm_cd2, month, '성·연령 인구'),
    );
    const birthRows = months.map((month) =>
      requiredAggregate(births, region.adm_cd2, month, '출생'),
    );
    const deathRows = months.map((month) =>
      requiredAggregate(deaths, region.adm_cd2, month, '사망'),
    );

    return RegionSeriesSchema.parse({
      ...region,
      months,
      population: residentRows.map((row) => row.population),
      households: residentRows.map((row) => row.households),
      populationDensity: residentRows.map((row) => row.population / region.areaSquareKm),
      youthPopulation: ageRows.map((row) => row.youthPopulation),
      workingAgePopulation: ageRows.map((row) => row.workingAgePopulation),
      elderlyPopulation: ageRows.map((row) => row.elderlyPopulation),
      onePersonHouseholds: months.map(
        (month) => onePerson.get(`${region.adm_cd2}|${month}`)?.onePersonHouseholds ?? null,
      ),
      births: birthRows.map((row) => row.births),
      deaths: deathRows.map((row) => row.deaths),
      naturalChange: birthRows.map((row, index) =>
        calculateNaturalChange({ births: row.births, deaths: deathRows[index].deaths }),
      ),
    });
  });

  return {
    mode: 'live',
    referenceMonth: months.at(-1)!,
    months,
    regions: normalizedRegions,
    facilities: normalizeFacilities(input.facilities),
    sourceNotes: input.sourceNotes ?? [
      '공공데이터 응답을 검증해 정규화했으며 누락된 1인세대 값은 추정하지 않습니다.',
    ],
  };
}
