import { z } from "zod";

import {
  FacilitySchema,
  type Facility,
} from "@/lib/domain/schemas";
import {
  assignPointToRegion,
  type AssignableRegion,
} from "@/lib/data/region-assignment";
import { PublicDataError, parsePublicDataPage } from "@/lib/data/public-api";

const PUBLIC_DATA_ORIGIN = "https://apis.data.go.kr";
const MEDICAL_PATH = "/6260000/MedicInstitService/MedicalInstitInfo";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PAGES = 200;

export interface MedicalFacilityFetchOptions {
  serviceKey: string;
  pageNo?: number;
  numOfRows?: number;
}

export interface MedicalFacilityFetchDeps {
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

function firstValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function buildMedicalInstitutionsUrl(options: MedicalFacilityFetchOptions): string {
  const serviceKey = options.serviceKey?.trim();
  if (!serviceKey) {
    throw new PublicDataError("공공데이터 인증키가 없습니다.");
  }

  const url = new URL(MEDICAL_PATH, PUBLIC_DATA_ORIGIN);
  url.searchParams.set("serviceKey", decodeServiceKeyOnce(serviceKey));
  url.searchParams.set("pageNo", String(options.pageNo ?? 1));
  url.searchParams.set("numOfRows", String(options.numOfRows ?? 1_000));
  url.searchParams.set("resultType", "json");
  return url.toString();
}

export function normalizeFacilityTypeLabel(value: string): Facility["type"] | null {
  const types: Facility["type"][] = [
    "약국",
    "요양병원",
    "종합병원",
    "치과의원",
    "한의원",
    "의원",
    "보건소",
    "병원",
  ];
  return types.find((type) => value.includes(type)) ?? null;
}

function buildHours(row: Record<string, unknown>): Record<string, string | null> | null {
  const dayMap: Array<[string, string[]]> = [
    ["mon", ["monOpen", "mon_open", "mondayOpen", "trmtMonStart", "MonOpen"]],
    ["tue", ["tueOpen", "tue_open", "tuesdayOpen", "trmtTueStart", "TueOpen"]],
    ["wed", ["wedOpen", "wed_open", "wednesdayOpen", "trmtWedStart", "WedOpen"]],
    ["thu", ["thuOpen", "thu_open", "thursdayOpen", "trmtThuStart", "ThuOpen"]],
    ["fri", ["friOpen", "fri_open", "fridayOpen", "trmtFriStart", "FriOpen"]],
    ["sat", ["satOpen", "sat_open", "saturdayOpen", "trmtSatStart", "SatOpen"]],
    ["sun", ["sunOpen", "sun_open", "sundayOpen", "trmtSunStart", "SunOpen"]],
  ];

  const hours: Record<string, string | null> = {};
  let found = false;

  for (const [day, keys] of dayMap) {
    const open = asString(firstValue(row, keys));
    const closeKeys = keys.map((key) =>
      key.replace(/Open|Start/i, (match) => (match.toLowerCase().includes("start") ? "End" : "Close")),
    );
    const close = asString(firstValue(row, closeKeys));
    if (open || close) {
      found = true;
      hours[day] = open && close ? `${open}-${close}` : open ?? close;
    }
  }

  return found ? hours : null;
}

export function mapMedicalRowToFacility(
  row: Record<string, unknown>,
  regions: readonly AssignableRegion[],
  index: number,
): Facility | null {
  const name =
    asString(
      firstValue(row, [
        "instit_nm",
        "medicalInstitNm",
        "yadmNm",
        "dutyName",
        "name",
        "facilityName",
      ]),
    ) ?? null;
  const typeLabel =
    asString(
      firstValue(row, [
        "medical_instit_kind_nm",
        "medicalInstitKindNm",
        "clCdNm",
        "dutyDivNam",
        "type",
        "category",
      ]),
    ) ?? "";
  const facilityType = normalizeFacilityTypeLabel(typeLabel);
  const lat = asNumber(firstValue(row, ["lat", "latitude", "YPos", "ypos", "wgs84Lat", "y_pos"]));
  const lng = asNumber(firstValue(row, ["lng", "longitude", "XPos", "xpos", "wgs84Lon", "x_pos"]));

  if (!name || !facilityType || lat === null || lng === null) {
    return null;
  }

  // Source API sometimes swaps x/y naming; reject clearly out-of-region points later.
  if (lat < 30 || lat > 40 || lng < 120 || lng > 135) {
    return null;
  }

  const region = assignPointToRegion({ lat, lng }, regions);
  if (!region) {
    return null;
  }

  const id =
    asString(firstValue(row, ["ykiho", "instit_cd", "medicalInstitCd", "hpid", "id"])) ??
    `gn-med-${index}-${region.adm_cd2}`;

  const specialtiesRaw = asString(
    firstValue(row, ["dgsbjtCdNm", "medicalDepartments", "specialties", "departments"]),
  );
  const specialties = specialtiesRaw
    ? specialtiesRaw
        .split(/[,;/|]/)
        .map((part) => part.trim())
        .filter(Boolean)
    : null;

  const parsed = FacilitySchema.safeParse({
    id,
    name,
    type: facilityType,
    adm_cd2: region.adm_cd2,
    adm_nm: region.adm_nm,
    lat,
    lng,
    specialties: specialties && specialties.length > 0 ? specialties : null,
    hours: buildHours(row),
    address:
      asString(firstValue(row, ["street_nm_addr", "addr", "dutyAddr", "address", "roadAddr"])) ??
      null,
    phone: asString(firstValue(row, ["tel_no", "telno", "dutyTel1", "phone"])) ?? null,
  });

  return parsed.success ? parsed.data : null;
}

export async function fetchMedicalInstitutionRows(
  options: MedicalFacilityFetchOptions,
  deps: MedicalFacilityFetchDeps = {},
): Promise<Array<Record<string, unknown>>> {
  const fetchImpl = deps.fetch ?? fetch;
  const items: Array<Record<string, unknown>> = [];
  const startPage = options.pageNo ?? 1;

  for (let offset = 0; offset < MAX_PAGES; offset += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetchImpl(
        buildMedicalInstitutionsUrl({
          ...options,
          pageNo: startPage + offset,
        }),
        {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new PublicDataError();
      }

      const page = parsePublicDataPage(await response.json());
      items.push(...page.items);

      if (
        page.items.length === 0 ||
        (page.totalCount > 0 && items.length >= page.totalCount) ||
        (page.totalCount === 0 && page.items.length < (options.numOfRows ?? 1_000))
      ) {
        return items;
      }
    } catch (error) {
      if (error instanceof PublicDataError) {
        throw error;
      }
      throw new PublicDataError();
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new PublicDataError("공공데이터 페이지 수가 허용 범위를 초과했습니다.");
}

export function facilitiesFromMedicalRows(
  rows: Array<Record<string, unknown>>,
  regions: readonly AssignableRegion[],
): Facility[] {
  const facilities: Facility[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const record = JsonRecordSchema.safeParse(row);
    if (!record.success) {
      return;
    }

    const facility = mapMedicalRowToFacility(record.data, regions, index);
    if (!facility || seen.has(facility.id)) {
      return;
    }

    seen.add(facility.id);
    facilities.push(facility);
  });

  return facilities;
}
