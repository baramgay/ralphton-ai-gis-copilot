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
  const header = ["순위", "행정동코드", "시도시", "이름", "값", "비고"];
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
