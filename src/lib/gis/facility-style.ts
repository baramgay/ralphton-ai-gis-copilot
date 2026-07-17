import type { Facility } from "@/lib/domain/schemas";

/** Facility type → map pin color (monotone + one accent family). */
export const FACILITY_TYPE_COLORS: Record<Facility["type"], string> = {
  종합병원: "#1d4ed8",
  병원: "#2563eb",
  요양병원: "#7c3aed",
  의원: "#0ea5e9",
  치과의원: "#0891b2",
  한의원: "#059669",
  보건소: "#ca8a04",
  약국: "#ea580c",
};

export function facilityTypeColor(type: Facility["type"] | string): string {
  return FACILITY_TYPE_COLORS[type as Facility["type"]] ?? "#64748b";
}

export function facilityTypeShort(type: Facility["type"] | string): string {
  const map: Record<string, string> = {
    종합병원: "종",
    병원: "병",
    요양병원: "요",
    의원: "의",
    치과의원: "치",
    한의원: "한",
    보건소: "보",
    약국: "약",
  };
  return map[type] ?? "?";
}

/** SVG data-URI marker for Kakao MarkerImage. */
export function facilityMarkerImageDataUri(type: Facility["type"] | string): string {
  const color = facilityTypeColor(type);
  const short = facilityTypeShort(type);
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
      `<circle cx="14" cy="14" r="12" fill="${color}" stroke="#fff" stroke-width="2.5"/>` +
      `<text x="14" y="18" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" font-family="sans-serif">${short}</text>` +
      `</svg>`,
  );
  return `data:image/svg+xml,${svg}`;
}
