export type ReportRow = {
  rank: number;
  name: string;
  valueLabel: string;
  note: string;
};

export type ReportInput = {
  title: string;
  summary: string;
  referenceMonth: string;
  source: string;
  mode: string;
  /** 분석 산식·한계. 보고서 각주로 그대로 옮긴다. */
  formulaNotes: string[];
  rows: ReportRow[];
  /** 표에 담을 상위 건수. 기본 10건. */
  topCount?: number;
  /** 내보낸 시각 표기(주입 가능 — 테스트 고정용). */
  exportedAt?: string;
};

function escapePipes(value: string): string {
  return value.replaceAll("|", "\\|");
}

/**
 * 분석 결과를 공공기관 보고서에 그대로 붙일 수 있는 개조식 마크다운으로 만든다.
 *
 * CSV는 원자료 첨부용이라 보고서 본문에 쓰기 어렵다. 여기서는 요약·표·산식·한계를
 * 갖춘 문단을 만들되, 서술식(~다/~한다) 대신 명사형으로 종결해 결과보고 양식에 맞춘다.
 * 수치는 화면에 표시된 값 문자열(valueLabel)을 그대로 옮겨 단위·자릿수가 어긋나지 않게 한다.
 */
export function buildMarkdownReport(input: ReportInput): string {
  const topCount = input.topCount ?? 10;
  const top = input.rows.slice(0, topCount);
  const lines: string[] = [];

  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(`- 기준월: ${input.referenceMonth}`);
  lines.push(`- 자료출처: ${input.source}`);
  lines.push(`- 데이터모드: ${input.mode}`);
  if (input.exportedAt) lines.push(`- 작성시각: ${input.exportedAt}`);
  lines.push("");

  lines.push("## 분석 요약");
  lines.push("");
  lines.push(`- ${input.summary}`);
  lines.push(`- 대상 행정동 ${input.rows.length.toLocaleString("ko-KR")}개 중 상위 ${top.length}개 제시`);
  lines.push("");

  lines.push(`## 상위 ${top.length}개 지역`);
  lines.push("");
  if (top.length === 0) {
    lines.push("- 표시할 순위 없음");
  } else {
    lines.push("| 순위 | 지역 | 값 | 비고 |");
    lines.push("| ---: | --- | --- | --- |");
    for (const row of top) {
      lines.push(
        `| ${row.rank} | ${escapePipes(row.name)} | ${escapePipes(row.valueLabel)} | ${escapePipes(row.note)} |`,
      );
    }
  }
  lines.push("");

  if (input.formulaNotes.length > 0) {
    lines.push("## 산식 및 해석 기준");
    lines.push("");
    for (const note of input.formulaNotes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## 유의사항");
  lines.push("");
  lines.push("- 순위는 기준월 단일 시점 값이며 추세 판단에는 다월 비교 필요");
  lines.push("- 절대값 지표는 인구·상권 규모에 좌우되므로 비율 지표와 병행 해석 필요");
  lines.push("");

  return lines.join("\n");
}
