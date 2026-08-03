import { z } from 'zod';

const PUBLIC_DATA_ORIGIN = 'https://apis.data.go.kr';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PAGES = 1_000;

export const PUBLIC_DATA_ENDPOINTS = {
  residentPopulation: '/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus',
  ageSexPopulation: '/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn',
  onePersonHouseholds: '/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh',
  /*
   * 출생·사망 경로는 카탈로그에 없는 이름이었다(`admmBrthRegist`·`admmDthRegist` →
   * NO_OPENAPI_SERVICE_ERROR). 실제 이름은 아래 둘이고 이 키에 이미 승인돼 있다.
   * 사망은 "사망**말소**자수"라 Ersr이다. docs/PUBLIC-DATA-API-SPEC.md 참고.
   */
  births: '/1741000/admmSexdBrthReg/selectAdmmSexdBrthReg',
  deaths: '/1741000/admmSexdAgeErsr/selectAdmmSexdAgeErsr',
} as const;

export type PublicDataDataset = keyof typeof PUBLIC_DATA_ENDPOINTS;

export interface PublicDataUrlOptions {
  serviceKey: string;
  pageNo?: number;
  numOfRows?: number;
  referenceMonth?: string;
  /** 조회 시작·종료 월. 한 번에 최대 4개월. */
  fromMonth?: string;
  toMonth?: string;
  /** 행정동 10자리. 이 API는 시도·시군구 코드로는 NODATA를 돌려준다. */
  admmCode?: string;
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
    /** 조회 시작·종료 월. 한 번에 최대 4개월(5개월부터 QUERY_PERIOD_LIMIT_EXCEEDED). */
    fromMonth: z.string().regex(/^\d{4}-?(0[1-9]|1[0-2])$/).optional(),
    toMonth: z.string().regex(/^\d{4}-?(0[1-9]|1[0-2])$/).optional(),
    /** 행정동 10자리. 이 API는 시도·시군구 코드로는 NODATA를 돌려준다. */
    admmCode: z.string().regex(/^\d{10}$/).optional(),
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

  /*
   * 이 API가 요구하는 월 파라미터는 `srchFrYm`·`srchToYm`이다. 예전에는 `stdgMtrYm`을
   * 보내고 있었고, 그래서 어떤 달을 물어도 NO_MANDATORY_REQUEST_PARAMETERS_ERROR가 왔다
   * — 인구 live가 한 번도 동작하지 않은 이유 중 하나다(docs/POPULATION-API-FINDINGS.md).
   * `referenceMonth`는 "그 달 하나"를 뜻하므로 시작·종료를 같게 둔다.
   */
  const from = parsed.data.fromMonth ?? parsed.data.referenceMonth;
  const to = parsed.data.toMonth ?? parsed.data.referenceMonth;
  if (from) url.searchParams.set('srchFrYm', from.replace('-', ''));
  if (to) url.searchParams.set('srchToYm', to.replace('-', ''));

  // 행정동 10자리가 필수다. 시도(4800000000)·시군구(4817000000)는 NODATA를 돌려준다.
  if (parsed.data.admmCode) {
    url.searchParams.set('admmCd', parsed.data.admmCode);
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

  // 1741000 계열은 `head`가 객체다(`{ resultCode, resultMsg, totalCount }`).
  const head = Array.isArray(response.head) ? null : asRecord(response.head);
  if (head) {
    const code = head.resultCode ?? head.resultCd;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
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

  /*
   * 1741000(행안부 주민등록) 계열은 `body`를 두지 않는다. `items`와 `head`가 `Response`
   * 바로 아래에 있다 — `Response.items.item[]`, `Response.head.totalCount`. 예전 파서는
   * `response.body`만 봐서, 응답이 정상(resultCode 0, totalCount 61)인데도 0행으로
   * 읽었다(docs/POPULATION-API-FINDINGS.md).
   */
  const body = asRecord(response.body) ?? response;
  const head = asRecord(response.head);

  const totalCount = toNonnegativeInteger(body.totalCount ?? head?.totalCount, 0);
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
