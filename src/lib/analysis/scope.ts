/**
 * Gyeongnam analysis scope helpers.
 */

export function stripSido(admNm: string): string {
  return admNm.replace(/^경상남도\s*/, "").trim();
}

export function sggCodeOf(dongCode: string): string {
  return dongCode.slice(0, 5);
}

export function sggNameOf(admNm: string): string {
  // "경상남도 창원시 의창구 동읍" → "창원시 의창구"; "경상남도 진주시 천전동" → "진주시"
  const withoutSido = admNm.replace(/^경상남도\s*/, "");
  const parts = withoutSido.split(/\s+/);
  return parts[0]?.endsWith("시") && parts[1]?.endsWith("구")
    ? `${parts[0]} ${parts[1]}`
    : parts[0] ?? "";
}

export function isGyeongnam(dongCode: string): boolean {
  return String(dongCode).startsWith("48");
}
