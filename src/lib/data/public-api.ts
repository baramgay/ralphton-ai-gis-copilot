import { z } from 'zod';

const PUBLIC_DATA_ORIGIN = 'https://apis.data.go.kr';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PAGES = 1_000;

export const PUBLIC_DATA_ENDPOINTS = {
  residentPopulation: '/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus',
  ageSexPopulation: '/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn',
  onePersonHouseholds: '/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh',
  births: '/1741000/admmBrthRegist/selectAdmmBrthRegist',
  deaths: '/1741000/admmDthRegist/selectAdmmDthRegist',
} as const;

export type PublicDataDataset = keyof typeof PUBLIC_DATA_ENDPOINTS;

export interface PublicDataUrlOptions {
  serviceKey: string;
  pageNo?: number;
  numOfRows?: number;
  referenceMonth?: string;
  ctpvCode?: string;
  sggCode?: string;
}

export interface PublicDataFetchDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface PublicDataPage {
  items: Array<Record<string, unknown>>;
  pageNo: number;
  numOfRows: number;
  totalCount: number;
}

export class PublicDataError extends Error {
  constructor(message = '공공데이터 요청을 처리할 수 없습니다.') {
    super(message);
    this.name = 'PublicDataError';
  }
}

const UrlOptionsSchema = z
  .object({
    serviceKey: z.string().trim().min(1),
    pageNo: z.number().int().positive().optional(),
    numOfRows: z.number().int().min(1).max(10_000).optional(),
    referenceMonth: z.string().regex(/^\d{4}-?(0[1-9]|1[0-2])$/).optional(),
    ctpvCode: z.string().regex(/^\d{2}$/).optional(),
    sggCode: z.string().regex(/^\d{2,5}$/).optional(),
  })
  .strict();

const JsonRecordSchema = z.record(z.string(), z.unknown());

function decodeServiceKeyOnce(serviceKey: string): string {
  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
}

export function buildPublicDataUrl(
  dataset: PublicDataDataset,
  options: PublicDataUrlOptions,
): string {
  const parsed = UrlOptionsSchema.safeParse(options);

  if (!parsed.success) {
    throw new PublicDataError('공공데이터 요청 매개변수가 올바르지 않습니다.');
  }

  const url = new URL(PUBLIC_DATA_ENDPOINTS[dataset], PUBLIC_DATA_ORIGIN);
  url.searchParams.set('serviceKey', decodeServiceKeyOnce(parsed.data.serviceKey));
  url.searchParams.set('pageNo', String(parsed.data.pageNo ?? 1));
  url.searchParams.set('numOfRows', String(parsed.data.numOfRows ?? 1_000));
  url.searchParams.set('type', 'json');

  if (parsed.data.referenceMonth) {
    url.searchParams.set('stdgMtrYm', parsed.data.referenceMonth.replace('-', ''));
  }

  if (parsed.data.ctpvCode) {
    url.searchParams.set('ctpvCd', parsed.data.ctpvCode);
  }

  if (parsed.data.sggCode) {
    url.searchParams.set('sggCd', parsed.data.sggCode);
  }

  return url.toString();
}

export const buildResidentPopulationUrl = (options: PublicDataUrlOptions) =>
  buildPublicDataUrl('residentPopulation', options);

export const buildAgeSexPopulationUrl = (options: PublicDataUrlOptions) =>
  buildPublicDataUrl('ageSexPopulation', options);

export const buildOnePersonHouseholdsUrl = (options: PublicDataUrlOptions) =>
  buildPublicDataUrl('onePersonHouseholds', options);

export const buildBirthsUrl = (options: PublicDataUrlOptions) =>
  buildPublicDataUrl('births', options);

export const buildDeathsUrl = (options: PublicDataUrlOptions) =>
  buildPublicDataUrl('deaths', options);

function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = JsonRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toNonnegativeInteger(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function extractResultCode(response: Record<string, unknown>): string | null {
  const header = asRecord(response.header);

  if (header) {
    const code = header.resultCode ?? header.resultCd;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
  }

  if (Array.isArray(response.head)) {
    for (const entry of response.head) {
      const record = asRecord(entry);
      const result = record ? asRecord(record.RESULT ?? record.result) : null;
      const code = result?.resultCode ?? result?.resultCd;

      if (typeof code === 'string' || typeof code === 'number') {
        return String(code);
      }
    }
  }

  return null;
}

function parseItems(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) {
    const parsed = z.array(JsonRecordSchema).safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  const record = asRecord(value);

  if (!record) {
    return null;
  }

  if ('item' in record) {
    if (Array.isArray(record.item)) {
      const parsed = z.array(JsonRecordSchema).safeParse(record.item);
      return parsed.success ? parsed.data : null;
    }

    const single = asRecord(record.item);
    return single ? [single] : null;
  }

  return null;
}

export function parsePublicDataPage(value: unknown): PublicDataPage {
  const root = asRecord(value);
  const response = root ? asRecord(root.response ?? root.Response) : null;

  if (!response) {
    throw new PublicDataError('공공데이터 응답 형식이 올바르지 않습니다.');
  }

  const resultCode = extractResultCode(response);

  if (resultCode && !['0', '00', 'INFO-000'].includes(resultCode)) {
    throw new PublicDataError('공공데이터 공급자가 요청을 거부했습니다.');
  }

  const body = asRecord(response.body);

  if (!body) {
    throw new PublicDataError('공공데이터 응답 본문이 없습니다.');
  }

  const totalCount = toNonnegativeInteger(body.totalCount, 0);
  const items = parseItems(body.items);

  if (!items && totalCount !== 0) {
    throw new PublicDataError('공공데이터 항목 형식이 올바르지 않습니다.');
  }

  if (!items && !('items' in body)) {
    throw new PublicDataError('공공데이터 항목이 없습니다.');
  }

  return {
    items: items ?? [],
    pageNo: toNonnegativeInteger(body.pageNo, 1) || 1,
    numOfRows: toNonnegativeInteger(body.numOfRows, items?.length ?? 0),
    totalCount,
  };
}

export async function fetchPublicDataPage(
  dataset: PublicDataDataset,
  options: PublicDataUrlOptions,
  deps: PublicDataFetchDeps = {},
): Promise<PublicDataPage> {
  const fetchImpl = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(buildPublicDataUrl(dataset, options), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new PublicDataError();
    }

    return parsePublicDataPage(await response.json());
  } catch (error) {
    if (error instanceof PublicDataError) {
      throw error;
    }

    throw new PublicDataError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllPublicDataPages(
  dataset: PublicDataDataset,
  options: PublicDataUrlOptions,
  deps: PublicDataFetchDeps = {},
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  const startPage = options.pageNo ?? 1;

  for (let offset = 0; offset < MAX_PAGES; offset += 1) {
    const page = await fetchPublicDataPage(
      dataset,
      { ...options, pageNo: startPage + offset },
      deps,
    );
    items.push(...page.items);

    if (
      page.items.length === 0 ||
      (page.totalCount > 0 && items.length >= page.totalCount) ||
      (page.totalCount === 0 && page.items.length < (options.numOfRows ?? 1_000))
    ) {
      return items;
    }
  }

  throw new PublicDataError('공공데이터 페이지 수가 허용 범위를 초과했습니다.');
}
