/**
 * Analysis rank / facility tables → CSV for download.
 */

export type CsvRankRow = {
  rank: number;
  code: string;
  name: string;
  valueLabel: string;
  note: string;
  /** 경남 | empty */
  sido?: string;
};

export type CsvFacilityRow = {
  id: string;
  name: string;
  type: string;
  region: string;
  address: string;
  sido?: string;
};

/**
 * 내보낼 표의 기준월·출처를 고른다.
 *
 * 화면에 보이는 분석이 곧 내보내는 표다. 민간 큐브 레이어와 교차분석은 공공 스냅샷과
 * 기준월·출처가 다르므로, 스냅샷 값을 그대로 찍으면 보고서에 잘못된 기준월이 실린다.
 * 우선순위: 결과 자체의 provenance > 활성 큐브 레이어 > 공공 스냅샷.
 */
export function resolveExportProvenance(input: {
  analysisProvenance?: { referenceMonth: string; source: string };
  activeLayer?: { referenceMonth: string; provider: string; label: string } | null;
  snapshotReferenceMonth: string;
  snapshotSource: string;
}): { referenceMonth: string; source: string } {
  if (input.analysisProvenance) return input.analysisProvenance;
  if (input.activeLayer) {
    return {
      referenceMonth: input.activeLayer.referenceMonth,
      source: `${input.activeLayer.provider} · ${input.activeLayer.label}`,
    };
  }
  return { referenceMonth: input.snapshotReferenceMonth, source: input.snapshotSource };
}

/**
 * 내보낼 행이 행정동인지 시군구인지 코드로 판별한다.
 *
 * 시군구까지만 있는 지표(KCB 전출)나 "시군구별로" 물은 질의는 결과가 22개 시군구인데,
 * 표 머리글과 요약이 "행정동"으로 고정돼 있어 22개 행정동을 본 것처럼 읽혔다.
 * 코드는 행에 이미 실려 있다 — 따로 넘길 필요가 없다.
 *
 * 시군구 코드는 두 형태가 섞여 있다: 민간 레이어 집계(aggregate.ts)는 5자리 그대로
 * ("48170")를 쓰고, 공공 도구 합산(tool-registry.ts의 rollupToDistricts)은 10자리
 * 행정동 코드 규약을 지키며 뒤 5자리를 0으로 채운다("4817000000"). 5자리만 보면
 * 후자가 걸러지지 않아 22개 시군구 결과가 다시 "행정동"으로 표기됐다(4차 리포트, prod 실측).
 */
export function regionUnitLabel(codes: readonly string[]): "행정동" | "시군구" | "격자" {
  if (codes.length === 0) return "행정동";
  // 격자 코드는 "gx_gy"라 자리수로 가릴 수 없다. 밑줄이 그 표시다.
  if (codes.every((code) => code.includes("_"))) return "격자";
  const isSggCode = (code: string) => code.length === 5 || (code.length === 10 && code.endsWith("00000"));
  return codes.every(isSggCode) ? "시군구" : "행정동";
}

export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string) => {
    const value = cell.replaceAll('"', '""');
    return /[",\n\r]/.test(value) ? `"${value}"` : value;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escape(cell ?? "")).join(","));
  }
  // Excel-friendly UTF-8 BOM
  return `\uFEFF${lines.join("\r\n")}`;
}

export function rankedToCsv(
  title: string,
  referenceMonth: string,
  dataSource: string,
  mode: string,
  rows: CsvRankRow[],
): string {
  const meta = [
    ["제목", title],
    ["기준월", referenceMonth],
    ["데이터모드", mode],
    ["출처", dataSource],
    ["내보낸시각", new Date().toISOString()],
  ];
  const header = ["순위", `${regionUnitLabel(rows.map((row) => row.code))}코드`, "시도시", "이름", "값", "비고"];
  const body = rows.map((row) => [
    String(row.rank),
    row.code,
    row.sido ?? "",
    row.name,
    row.valueLabel,
    row.note,
  ]);
  const metaBlock = meta.map(([k, v]) => `${k},${escapeCsvCell(v)}`).join("\r\n");
  return `\uFEFF${metaBlock}\r\n\r\n${toCsv(header, body).replace(/^\uFEFF/, "")}`;
}

function escapeCsvCell(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function facilitiesToCsv(
  title: string,
  referenceMonth: string,
  dataSource: string,
  mode: string,
  rows: CsvFacilityRow[],
): string {
  const meta = [
    ["제목", title],
    ["기준월", referenceMonth],
    ["데이터모드", mode],
    ["출처", dataSource],
    ["내보낸시각", new Date().toISOString()],
  ];
  const header = ["ID", "시설명", "유형", "시도시", "행정동", "주소"];
  const body = rows.map((row) => [
    row.id,
    row.name,
    row.type,
    row.sido ?? "",
    row.region,
    row.address,
  ]);
  const metaBlock = meta.map(([k, v]) => `${k},${escapeCsvCell(v)}`).join("\r\n");
  return `\uFEFF${metaBlock}\r\n\r\n${toCsv(header, body).replace(/^\uFEFF/, "")}`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
