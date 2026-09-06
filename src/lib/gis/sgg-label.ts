/** 행정동 코드 앞 다섯 자리가 시군구. */
export function sggCodeOf(admCd2: string): string {
  return admCd2.slice(0, 5);
}

/**
 * 행정동 이름에서 시군구만 남긴다.
 * 「경상남도 창원시 의창구 동읍」→「창원시 의창구」, 「경상남도 김해시 내외동」→「김해시」.
 */
export function sggLabelOf(admNm: string): string {
  const parts = admNm.replace(/^경상남도\s*/, "").trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(0, -1).join(" ");
}

export type SggLabelPoint = { code: string; name: string; lat: number; lng: number };

/** 시군구마다 소속 행정동 대표점의 평균. 첫 화면 이름 표시에 쓴다. */
export function sggLabelPoints(
  regions: readonly { adm_cd2: string; adm_nm: string; representativePoint: { lat: number; lng: number } }[],
): SggLabelPoint[] {
  const buckets = new Map<string, { name: string; lat: number; lng: number; n: number }>();
  for (const region of regions) {
    const code = sggCodeOf(region.adm_cd2);
    const current = buckets.get(code);
    if (current) {
      current.lat += region.representativePoint.lat;
      current.lng += region.representativePoint.lng;
      current.n += 1;
    } else {
      buckets.set(code, {
        name: sggLabelOf(region.adm_nm),
        lat: region.representativePoint.lat,
        lng: region.representativePoint.lng,
        n: 1,
      });
    }
  }
  return [...buckets.entries()].map(([code, value]) => ({
    code,
    name: value.name,
    lat: value.lat / value.n,
    lng: value.lng / value.n,
  }));
}
