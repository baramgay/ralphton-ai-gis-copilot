/**
 * Extract Busan gu/gun labels from administrative dong names.
 */

export function districtFromAdmName(admNm: string): string | null {
  const rest = admNm.replace(/^부산광역시\s*/, "").trim();
  const token = rest.split(/\s+/)[0] ?? "";
  if (!token) return null;
  if (/[구현군]$/.test(token)) return token;
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

/** Compact dong labels for pairwise compare (unique within Busan list). */
export function listDongLabels(regions: Array<{ adm_nm: string; adm_cd2: string }>): string[] {
  return regions
    .map((region) => region.adm_nm.replace(/^부산광역시\s*/, "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
}

export type CompareScope = "gu" | "dong";

export const DEFAULT_COMPARE: [string, string] = ["기장군", "강서구"];

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
