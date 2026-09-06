import { sggCodeOf, sggLabelOf } from "@/lib/gis/sgg-label";

export type HoverRow = {
  code: string;
  name: string;
  valueLabel: string;
  metrics?: readonly { label: string; value: number | null; unit: string }[];
};

export type HoverCaption = {
  name: string;
  value: string | null;
};

function stripSido(name: string): string {
  return name.replace(/^경상남도\s*/, "").trim();
}

function formatHoverValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "데이터 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}

function valueText(row: HoverRow): string {
  if (row.metrics && row.metrics.length > 0) {
    return row.metrics
      .map((metric) => `${metric.label} ${formatHoverValue(metric.value, metric.unit)}`)
      .join(" · ");
  }
  return row.valueLabel;
}

function matchHoverRow(code: string, rows: readonly HoverRow[]): HoverRow | undefined {
  const exact = rows.find((row) => row.code === code);
  if (exact) return exact;
  if (code.length >= 10) {
    const sgg = sggCodeOf(code);
    return rows.find((row) => row.code === sgg);
  }
  if (code.length === 5) {
    return rows.find((row) => row.code.length >= 10 && sggCodeOf(row.code) === code);
  }
  return undefined;
}

/**
 * 지도 호버 문구. 분석이 있으면 그 단위(시군·행정동·격자)의 값을 적고,
 * 없으면 시군 이름만 남긴다. 없는 값을 점수로 메우지 않는다.
 */
export function hoverCaptionOf(
  featureCode: string,
  featureName: string,
  rows: readonly HoverRow[],
): HoverCaption {
  const row = matchHoverRow(featureCode, rows);
  if (row) {
    return { name: stripSido(row.name), value: valueText(row) };
  }
  if (rows.length === 0) {
    const sgg = sggLabelOf(featureName);
    return { name: sgg || stripSido(featureName), value: null };
  }
  return { name: stripSido(featureName), value: null };
}
