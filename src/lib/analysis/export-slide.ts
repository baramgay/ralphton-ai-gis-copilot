import { toNounEnding, type ReportInput } from "@/lib/analysis/export-report";

/**
 * 분석 결과를 발표용 슬라이드 HTML로 만든다.
 *
 * PPTX는 OOXML ZIP이라 브라우저에서 조립하면 파워포인트에서 열리지 않을 위험이 크고
 * 검증도 어렵다(HWPX와 같은 이유). 대신 파워포인트·한글이 모두 여는 HTML 슬라이드를
 * 만든다 — 인쇄(Ctrl+P)로 PDF 배포가 되고, 표는 복사해 슬라이드에 붙일 수 있다.
 *
 * 한 장에 다 넣지 않고 표지·핵심결과·근거의 3장으로 나눈다. 보고 자리에서 그대로 넘길 수
 * 있는 최소 구성이다.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SLIDE_STYLE = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Pretendard','맑은 고딕',Malgun Gothic,sans-serif; color: #111; }
  .slide { width: 297mm; height: 210mm; padding: 18mm 20mm; page-break-after: always;
           display: flex; flex-direction: column; border-bottom: 1px solid #ddd; }
  .slide:last-child { page-break-after: auto; border-bottom: none; }
  .eyebrow { font-size: 11pt; color: #666; letter-spacing: .02em; }
  h1 { font-size: 30pt; margin: 6mm 0 4mm; line-height: 1.25; }
  h2 { font-size: 20pt; margin: 0 0 6mm; }
  .lead { font-size: 13pt; line-height: 1.6; color: #222; }
  ul { font-size: 12pt; line-height: 1.75; padding-left: 5mm; margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 11pt; }
  th, td { border: 1px solid #999; padding: 2.5mm 3mm; text-align: left; }
  th { background: #f1f1f1; }
  td.num { text-align: right; }
  .foot { margin-top: auto; font-size: 9.5pt; color: #777; }
`;

/** 표지·핵심결과·근거 3장 슬라이드. */
export function buildSlideHtml(input: ReportInput): string {
  const top = input.rows.slice(0, input.topCount ?? 8);
  const totalCount = input.totalCount ?? input.rows.length;
  const foot = `${escapeHtml(input.source)} · 기준월 ${escapeHtml(input.referenceMonth)}`;
  const slides: string[] = [];

  slides.push(`
    <section class="slide">
      <p class="eyebrow">경상남도 공간데이터 분석</p>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="lead">${escapeHtml(toNounEnding(input.summary))}</p>
      <p class="foot">${foot}${input.exportedAt ? ` · ${escapeHtml(input.exportedAt)}` : ""}</p>
    </section>`);

  const rows =
    top.length === 0
      ? '<tr><td colspan="4">표시할 순위 없음</td></tr>'
      : top
          .map(
            (row) =>
              `<tr><td class="num">${row.rank}</td><td>${escapeHtml(row.name)}</td>` +
              `<td>${escapeHtml(row.valueLabel)}</td><td>${escapeHtml(row.note)}</td></tr>`,
          )
          .join("");
  slides.push(`
    <section class="slide">
      <h2>상위 ${top.length}개 지역</h2>
      <table>
        <tr><th>순위</th><th>지역</th><th>값</th><th>비고</th></tr>
        ${rows}
      </table>
      <p class="foot">대상 행정동 ${totalCount.toLocaleString("ko-KR")}개 중 상위 ${top.length}개 · ${foot}</p>
    </section>`);

  const notes = input.formulaNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  slides.push(`
    <section class="slide">
      <h2>산식 및 해석 기준</h2>
      <ul>
        ${notes}
        <li>순위는 기준월 단일 시점 값이며 추세 판단에는 다월 비교 필요</li>
        <li>절대값 지표는 인구·상권 규모에 좌우되므로 비율 지표와 병행 해석 필요</li>
      </ul>
      <p class="foot">${foot}</p>
    </section>`);

  return [
    '<html><head><meta charset="utf-8"><title>',
    escapeHtml(input.title),
    "</title><style>",
    SLIDE_STYLE,
    "</style></head><body>",
    slides.join(""),
    "</body></html>",
  ].join("");
}
