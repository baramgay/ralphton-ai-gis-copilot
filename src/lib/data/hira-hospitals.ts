/**
 * HIRA (건강보험심사평가원) 병원정보서비스 v2
 * Endpoint: https://apis.data.go.kr/B551182/hospInfoServicev2
 * Format: XML · Operation: getHospBasisList
 *
 * 시도 코드: 부산 210000, 경남 380000
 */

import { z } from "zod";

import {
  FacilitySchema,
  type Facility,
} from "@/lib/domain/schemas";
import {
  assignPointToRegion,
  type AssignableRegion,
} from "@/lib/data/region-assignment";
import { PublicDataError } from "@/lib/data/public-api";
import { normalizeFacilityTypeLabel } from "@/lib/data/medical-facilities";

const PUBLIC_DATA_ORIGIN = "https://apis.data.go.kr";
const HIRA_PATH = "/B551182/hospInfoServicev2/getHospBasisList";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAGES = 80;
const PAGE_SIZE = 1_000;

/** HIRA sidoCd for supported analysis regions. */
export const HIRA_SIDO = {
  busan: "210000",
  gyeongnam: "380000",
} as const;

export type HiraSidoKey = keyof typeof HIRA_SIDO;

export interface HiraHospitalFetchOptions {
  serviceKey: string;
  /** Default: both Busan and Gyeongnam */
  sidoCds?: string[];
  pageNo?: number;
  numOfRows?: number;
}

export interface HiraHospitalFetchDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const JsonRecordSchema = z.record(z.string(), z.unknown());

function decodeServiceKeyOnce(serviceKey: string): string {
  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
}

function asString(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Map HIRA clCdNm (and clCd) to our Facility type. */
export function mapHiraClinicType(clCdNm: string | null, clCd?: string | null): Facility["type"] | null {
  const label = (clCdNm ?? "").trim();
  if (label) {
    if (label.includes("상급종합") || label === "종합병원") return "종합병원";
    if (label === "요양병원") return "요양병원";
    if (label === "병원" || label === "치과병원" || label === "한방병원") return "병원";
    if (label === "의원") return "의원";
    if (label.includes("치과")) return "치과의원";
    if (label.includes("한의")) return "한의원";
    if (label.includes("보건")) return "보건소";
    if (label.includes("약국")) return "약국";
    const fromLabel = normalizeFacilityTypeLabel(label);
    if (fromLabel) return fromLabel;
  }

  // Fallback by clCd (HIRA codes)
  switch ((clCd ?? "").trim()) {
    case "01":
    case "11":
      return "종합병원";
    case "21":
    case "41":
    case "92":
    case "75":
      return "병원";
    case "28":
      return "요양병원";
    case "31":
      return "의원";
    case "51":
      return "치과의원";
    case "93":
      return "한의원";
    case "71":
    case "72":
    case "73":
      return "보건소";
    case "81":
      return "약국";
    default:
      return null;
  }
}

export function buildHiraHospBasisUrl(options: {
  serviceKey: string;
  sidoCd: string;
  pageNo?: number;
  numOfRows?: number;
}): string {
  const serviceKey = options.serviceKey?.trim();
  if (!serviceKey) {
    throw new PublicDataError("HIRA 병원 API 인증키가 없습니다.");
  }
  const url = new URL(HIRA_PATH, PUBLIC_DATA_ORIGIN);
  // data.go.kr expects the key already encoded in the query string for some gateways.
  url.searchParams.set("serviceKey", decodeServiceKeyOnce(serviceKey));
  url.searchParams.set("pageNo", String(options.pageNo ?? 1));
  url.searchParams.set("numOfRows", String(options.numOfRows ?? PAGE_SIZE));
  url.searchParams.set("sidoCd", options.sidoCd);
  return url.toString();
}

/**
 * Minimal XML item extractor for HIRA response (no extra dependency).
 * Parses repeating <item>...</item> blocks into key/value maps.
 */
export function parseHiraXmlItems(xml: string): {
  items: Array<Record<string, unknown>>;
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  resultCode: string;
  resultMsg: string;
} {
  const resultCode = xml.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1]?.trim() ?? "";
  const resultMsg = xml.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1]?.trim() ?? "";
  const totalCount = Number(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] ?? 0);
  const pageNo = Number(xml.match(/<pageNo>(\d+)<\/pageNo>/)?.[1] ?? 1);
  const numOfRows = Number(xml.match(/<numOfRows>(\d+)<\/numOfRows>/)?.[1] ?? 0);

  const items: Array<Record<string, unknown>> = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const body = match[1];
    const row: Record<string, unknown> = {};
    const fieldRe = /<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRe.exec(body)) !== null) {
      row[field[1]] = field[2];
    }
    items.push(row);
  }

  return { items, totalCount, pageNo, numOfRows, resultCode, resultMsg };
}

export function mapHiraRowToFacility(
  row: Record<string, unknown>,
  regions: readonly AssignableRegion[],
  index: number,
): Facility | null {
  const name = asString(row.yadmNm);
  const facilityType = mapHiraClinicType(asString(row.clCdNm), asString(row.clCd));
  // HIRA: XPos = longitude, YPos = latitude (WGS84)
  const lng = asNumber(row.XPos ?? row.xPos);
  const lat = asNumber(row.YPos ?? row.yPos);

  if (!name || !facilityType || lat === null || lng === null) {
    return null;
  }

  // Busan + Gyeongnam rough bounds
  if (lat < 34.2 || lat > 36.2 || lng < 127.3 || lng > 129.8) {
    return null;
  }

  const region = assignPointToRegion({ lat, lng }, regions);
  if (!region) {
    return null;
  }

  const id = asString(row.ykiho) ?? `hira-${name}-${lat.toFixed(5)}-${lng.toFixed(5)}-${index}`;

  const parsed = FacilitySchema.safeParse({
    id,
    name,
    type: facilityType,
    adm_cd2: region.adm_cd2,
    adm_nm: region.adm_nm,
    lat,
    lng,
    specialties: null,
    hours: null,
    address: asString(row.addr),
    phone: asString(row.telno),
  });

  return parsed.success ? parsed.data : null;
}

export async function fetchHiraHospitalRowsForSido(
  sidoCd: string,
  options: HiraHospitalFetchOptions,
  deps: HiraHospitalFetchDeps = {},
): Promise<Array<Record<string, unknown>>> {
  const fetchImpl = deps.fetch ?? fetch;
  const items: Array<Record<string, unknown>> = [];
  const startPage = options.pageNo ?? 1;
  const numOfRows = options.numOfRows ?? PAGE_SIZE;

  for (let offset = 0; offset < MAX_PAGES; offset += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const url = buildHiraHospBasisUrl({
        serviceKey: options.serviceKey,
        sidoCd,
        pageNo: startPage + offset,
        numOfRows,
      });
      const response = await fetchImpl(url, {
        headers: { Accept: "application/xml, text/xml, */*" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new PublicDataError(`HIRA 병원 API HTTP ${response.status}`);
      }

      const xml = await response.text();
      const page = parseHiraXmlItems(xml);

      if (page.resultCode && page.resultCode !== "00") {
        throw new PublicDataError(
          `HIRA 병원 API 오류: ${page.resultCode} ${page.resultMsg}`.trim(),
        );
      }

      items.push(...page.items);

      if (
        page.items.length === 0 ||
        (page.totalCount > 0 && items.length >= page.totalCount) ||
        page.items.length < numOfRows
      ) {
        return items;
      }
    } catch (error) {
      if (error instanceof PublicDataError) throw error;
      throw new PublicDataError(
        error instanceof Error ? error.message : "HIRA 병원 API 요청 실패",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new PublicDataError("HIRA 병원 API 페이지 수가 허용 범위를 초과했습니다.");
}

export async function fetchHiraHospitalRows(
  options: HiraHospitalFetchOptions,
  deps: HiraHospitalFetchDeps = {},
): Promise<Array<Record<string, unknown>>> {
  const sidoCds =
    options.sidoCds && options.sidoCds.length > 0
      ? options.sidoCds
      : [HIRA_SIDO.busan, HIRA_SIDO.gyeongnam];

  const all: Array<Record<string, unknown>> = [];
  for (const sidoCd of sidoCds) {
    const rows = await fetchHiraHospitalRowsForSido(sidoCd, options, deps);
    all.push(...rows);
  }
  return all;
}

export function facilitiesFromHiraRows(
  rows: Array<Record<string, unknown>>,
  regions: readonly AssignableRegion[],
): Facility[] {
  const facilities: Facility[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const record = JsonRecordSchema.safeParse(row);
    if (!record.success) return;
    const facility = mapHiraRowToFacility(record.data, regions, index);
    if (!facility || seen.has(facility.id)) return;
    seen.add(facility.id);
    facilities.push(facility);
  });

  return facilities;
}

/** Resolve HIRA key: dedicated env first, then shared data.go.kr key. */
export function resolveHiraServiceKey(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.HIRA_HOSP_SERVICE_KEY?.trim() ||
    process.env.DATA_GO_KR_SERVICE_KEY?.trim() ||
    ""
  );
}
