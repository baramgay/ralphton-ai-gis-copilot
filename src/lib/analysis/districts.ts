/**
 * Extract gu/gun (시군구) labels from Gyeongnam administrative dong names.
 */

const SIDO_PREFIX = /^경상남도\s*/;

export function stripSidoPrefix(admNm: string): string {
  return admNm.replace(SIDO_PREFIX, "").trim();
}

export function sidoFromAdmName(admNm: string): "경상남도" | null {
  if (admNm.startsWith("경상남도")) return "경상남도";
  return null;
}

export function districtFromAdmName(admNm: string): string | null {
  const rest = stripSidoPrefix(admNm);
  const token = rest.split(/\s+/)[0] ?? "";
  if (!token) return null;
  // 구/군 + 경남 시 (창원시, 진주시 등)
  if (/[구현군시]$/.test(token)) return token;
  return null;
}

export function listDistricts(regions: Array<{ adm_nm: string }>): string[] {
  const set = new Set<string>();
  for (const region of regions) {
    const district = districtFromAdmName(region.adm_nm);
    if (district) set.add(district);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

/** Compact dong labels for pairwise compare. */
export function listDongLabels(regions: Array<{ adm_nm: string; adm_cd2: string }>): string[] {
  return regions
    .map((region) => stripSidoPrefix(region.adm_nm))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
}

export type CompareScope = "gu" | "dong";

export const DEFAULT_COMPARE: [string, string] = ["진주시", "창원시"];

export function normalizeComparePair(
  a: string,
  b: string,
  available: string[],
): [string, string] {
  const pool = available.length > 0 ? available : [...DEFAULT_COMPARE];
  let left = a.trim() || DEFAULT_COMPARE[0];
  let right = b.trim() || DEFAULT_COMPARE[1];
  if (!pool.includes(left)) left = pool[0] ?? DEFAULT_COMPARE[0];
  if (!pool.includes(right) || right === left) {
    right = pool.find((item) => item !== left) ?? pool[0] ?? DEFAULT_COMPARE[1];
  }
  return [left, right];
}

/** Group districts by sido for UI filters. */
export function listDistrictsBySido(
  regions: Array<{ adm_nm: string }>,
): { sido: string; districts: string[] }[] {
  const map = new Map<string, Set<string>>();
  for (const region of regions) {
    const sido = sidoFromAdmName(region.adm_nm) ?? "기타";
    const district = districtFromAdmName(region.adm_nm);
    if (!district) continue;
    if (!map.has(sido)) map.set(sido, new Set());
    map.get(sido)!.add(district);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([sido, set]) => ({
      sido,
      districts: [...set].sort((a, b) => a.localeCompare(b, "ko")),
    }));
}
