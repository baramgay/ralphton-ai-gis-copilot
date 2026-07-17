/**
 * Busan + Gyeongnam analysis scope helpers.
 */

export type SidoScope = "all" | "busan" | "gyeongnam";

export const SIDO_SCOPE_LABEL: Record<SidoScope, string> = {
  all: "부산·경남",
  busan: "부산광역시",
  gyeongnam: "경상남도",
};

export function sidoTokenForScope(scope: SidoScope): string | null {
  if (scope === "busan") return "부산광역시";
  if (scope === "gyeongnam") return "경상남도";
  return null;
}

export function matchesSidoScope(admNm: string, scope: SidoScope): boolean {
  if (scope === "all") return true;
  if (scope === "busan") return admNm.startsWith("부산광역시");
  if (scope === "gyeongnam") return admNm.startsWith("경상남도");
  return true;
}

export function stripSido(admNm: string): string {
  return admNm.replace(/^부산광역시\s*/, "").replace(/^경상남도\s*/, "").trim();
}

export function sidoBadge(admNm: string): "부산" | "경남" | null {
  if (admNm.startsWith("부산광역시")) return "부산";
  if (admNm.startsWith("경상남도")) return "경남";
  return null;
}

export function countBySido(
  items: Array<{ adm_nm: string }>,
): { busan: number; gyeongnam: number; other: number } {
  let busan = 0;
  let gyeongnam = 0;
  let other = 0;
  for (const item of items) {
    if (item.adm_nm.startsWith("부산광역시")) busan += 1;
    else if (item.adm_nm.startsWith("경상남도")) gyeongnam += 1;
    else other += 1;
  }
  return { busan, gyeongnam, other };
}

/** Merge sido scope into intent regions without dropping user-selected districts. */
export function applySidoScopeToRegions(
  existing: string[] | undefined,
  scope: SidoScope,
): string[] | undefined {
  const token = sidoTokenForScope(scope);
  if (!token) return existing;
  if (!existing || existing.length === 0) return [token];
  // If user already narrowed to districts, keep them (they may be inside the sido).
  return existing;
}

export function filterBySidoScope<T extends { adm_nm: string }>(
  items: readonly T[],
  scope: SidoScope,
): T[] {
  if (scope === "all") return [...items];
  return items.filter((item) => matchesSidoScope(item.adm_nm, scope));
}
