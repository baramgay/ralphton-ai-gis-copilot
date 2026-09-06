import { downloadTextFile, regionUnitLabel } from "@/lib/analysis/export-csv";
import {
  rankWordOf,
  reportCitationWarning,
  reportModeLabel,
  reportSourceLabel,
  toNounEnding,
  type ReportInput,
} from "@/lib/analysis/export-report";

/**
 * 분석 결과를 **A4로 인쇄되는 HTML 보고서**로 만든다.
 *
 * 한글 붙여넣기용(`export-hwp`)과 목적이 다르다. 이쪽은 파일을 열어 그대로 인쇄하거나
 * PDF로 저장하는 완성본이라, 종이에서 무너지지 않는 것이 전부다.
 *
 * ## 종이에서 지키는 것
 *
 * - **머리글 반복.** `thead`에 `display: table-header-group`을 주지 않으면 표가 두 쪽을
 *   넘어갈 때 둘째 쪽에 열 이름이 없다. 순위표에서 이것은 읽을 수 없는 표가 된다는 뜻이다.
 * - **행이 쪽을 넘지 않는다.** `break-inside: avoid`가 없으면 한 지역의 값이 쪽 경계에서
 *   반으로 잘린다.
 * - **화면 테마를 따르지 않는다.** 이 도구의 기본 화면은 어두운데, 그 색을 그대로 인쇄하면
 *   토너를 통째로 붓거나(배경 인쇄 켬) 흰 글씨가 흰 종이에 찍힌다(배경 인쇄 끔).
 *   보고서는 늘 흰 바탕·검은 글씨다.
 * - **각주를 자른 채 내보내지 않는다.** 산식과 한계는 값과 함께 있어야 한다. 공공기관
 *   보고서에 표만 옮겨지면 「창원시는 구별 자료가 아니다」같은 단서가 사라진다.
 *
 * 문장은 개조식(명사형 종결)으로 바꾼다 — 화면은 서술식이지만 결과보고 양식은 명사형이다.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * 자료 성격을 우리말로.
 *
 * `mode`는 코드가 쓰는 말("live"·"demo")이다. 그대로 인쇄하면 공공기관 보고서에 영문
 * 상태값이 실린다 — 읽는 사람에게는 뜻이 없고, 무엇보다 시연 데이터인지 실데이터인지를
 * 가려 주지 못한다. 모르는 값은 지어내지 않고 그대로 적는다.
 */
function modeWord(input: ReportInput): string {
  if (input.mode !== "live" && input.mode !== "demo") return input.mode;
  if (input.mode === "demo") return "시연 데이터";
  return reportModeLabel(input);
}

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 20mm 18mm 18mm; }

  /* 인쇄본은 화면 테마를 따르지 않는다. 늘 흰 바탕·검은 글씨다. */
  :root { color-scheme: light; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: #fff;
    color: #111;
    font-family: Pretendard, "맑은 고딕", "Malgun Gothic", system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
  }

  .sheet { max-width: 174mm; margin: 0 auto; padding: 12mm 0; }

  .doc-head { border-bottom: 2px solid #111; padding-bottom: 6mm; margin-bottom: 8mm; }
  .doc-kicker { font-size: 9pt; letter-spacing: .08em; color: #555; margin: 0 0 2mm; }
  h1 { font-size: 17pt; margin: 0 0 3mm; letter-spacing: -.01em; }
  .doc-meta { font-size: 9pt; color: #444; margin: 0; }

  h2 {
    font-size: 12pt;
    margin: 8mm 0 3mm;
    padding-left: 3mm;
    border-left: 3px solid #111;
    /* 제목만 남고 내용이 다음 쪽으로 넘어가는 것을 막는다. */
    break-after: avoid;
  }

  .lead { margin: 0 0 4mm; font-size: 11pt; }

  ul { margin: 0 0 4mm; padding-left: 5mm; }
  li { margin-bottom: 1.5mm; }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  /* 표가 쪽을 넘어가면 둘째 쪽에도 열 이름이 있어야 읽을 수 있다. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 700; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.rank, th.rank { text-align: center; width: 12mm; }

  .notes { font-size: 8.5pt; color: #333; }
  .notes li { margin-bottom: 1mm; }

  .doc-foot {
    margin-top: 8mm;
    padding-top: 3mm;
    border-top: 1px solid #999;
    font-size: 8.5pt;
    color: #555;
  }

  /*
   * 화면에서 볼 때만 종이처럼 보이게 한다. 인쇄에서는 @page가 여백을 잡으므로
   * 이 그림자·테두리가 남으면 종이 위에 종이를 그린 꼴이 된다.
   */
  @media screen {
    body { background: #e9edf2; padding: 8mm 0; }
    .sheet { background: #fff; box-shadow: 0 2mm 8mm rgb(0 0 0 / 18%); padding: 16mm; }
  }

  @media print {
    .sheet { box-shadow: none; padding: 0; }
  }
`;

/**
 * 인쇄용 A4 보고서 HTML.
 *
 * 브라우저에서 열면 그대로 인쇄하거나 PDF로 저장된다. `printOnLoad`면 창이 뜨자마자
 * 인쇄 대화상자를 연다 — 「보고서」버튼이 PDF 저장으로 이어지게 하기 위해서다.
 */
export type A4ReportOptions = {
  printOnLoad?: boolean;
};

export function buildA4HtmlReport(input: ReportInput, options?: A4ReportOptions): string {
  const topCount = input.topCount ?? 20;
  const top = input.rows.slice(0, topCount);
  const totalCount = input.totalCount ?? input.rows.length;
  /*
   * 단위는 **한 행이 아니라 전체 행**으로 가린다. 첫 행만 보면 시군구 결과에 읍면동
   * 코드가 하나 섞여 있어도 「행정동」이라 적는다.
   */
  const unit = regionUnitLabel(input.rows.map((row) => row.code));
  const rankWord = rankWordOf(input.rows);
  const exportedAt = input.exportedAt ?? new Date().toISOString().slice(0, 10);

  const rows = top
    .map(
      (row) => `<tr>
      <td class="rank">${row.rank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td class="num">${escapeHtml(row.valueLabel)}</td>
      <td>${escapeHtml(row.note)}</td>
    </tr>`,
    )
    .join("\n");

  const citation = reportCitationWarning(input);
  const notes = [
    ...(citation ? [`<li>${escapeHtml(citation)}</li>`] : []),
    ...input.formulaNotes.map((note) => `<li>${escapeHtml(note)}</li>`),
  ].join("\n");
  const source = reportSourceLabel(input.source);
  const metaBits = [
    `기준월 ${escapeHtml(input.referenceMonth)}`,
    ...(source ? [`출처 ${escapeHtml(source)}`] : []),
    escapeHtml(modeWord(input)),
    `작성일 ${escapeHtml(exportedAt)}`,
  ];

  /*
   * 표가 상한에 걸려 잘렸으면 그 사실을 적는다. 적지 않으면 20행이 전부인 줄 알고
   * 「경남 20개 지역 중 1위」처럼 모수를 잘못 인용하게 된다.
   */
  const truncated =
    totalCount > top.length
      ? `<p class="doc-meta">※ 분석 대상 ${totalCount.toLocaleString("ko-KR")}개 ${unit} 중 ${rankWord} ${top.length}개만 표에 수록. 전체는 표로 내려받기 가능.</p>`
      : "";

  const printOnLoad = options?.printOnLoad
    ? `<script>window.addEventListener("load",function(){try{window.print();}catch(e){}});</script>`
    : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`누리맵-보고서-${input.referenceMonth}`)} — ${escapeHtml(input.title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="sheet">
  <header class="doc-head">
    <p class="doc-kicker">경상남도 공간데이터 분석</p>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="doc-meta">${metaBits.join(" · ")}</p>
  </header>

  <h2>1. 분석 개요</h2>
  <p class="lead">${escapeHtml(toNounEnding(input.summary))}</p>
  <ul>
    <li>분석 대상: ${totalCount.toLocaleString("ko-KR")}개 ${escapeHtml(unit)}</li>
    <li>정렬 기준: ${escapeHtml(rankWord)} 순</li>
    <li>기준 시점: ${escapeHtml(input.referenceMonth)}</li>
  </ul>

  <h2>2. 분석 결과</h2>
  <table>
    <thead>
      <tr>
        <th class="rank">순위</th>
        <th>지역</th>
        <th class="num">값</th>
        <th>비고</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  ${truncated}

  <h2>3. 산식 및 자료 한계</h2>
  <ul class="notes">
${notes}
  </ul>

  <footer class="doc-foot">
    누리맵(경남 공간데이터 분석) · ${escapeHtml(exportedAt)} 작성 · 인용 시 기준월과 자료 한계를 함께 표기
  </footer>
</div>
${printOnLoad}
</body>
</html>
`;
}

/**
 * 인쇄용 HTML을 새 창에서 연다. 인쇄 대화상자에서 PDF로 저장한다.
 * 팝업이 막히면 같은 내용을 HTML 파일로 내려받는다.
 */
export function openHtmlForPrint(html: string, documentTitle: string): "print" | "download" {
  if (typeof window === "undefined" || typeof document === "undefined") return "download";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    downloadTextFile(`${documentTitle}.html`, html, "text/html;charset=utf-8");
    URL.revokeObjectURL(url);
    return "download";
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "print";
}
