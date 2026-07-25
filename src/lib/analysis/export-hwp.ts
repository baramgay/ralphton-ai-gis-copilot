import { toNounEnding, type ReportInput } from "@/lib/analysis/export-report";

/**
 * 분석 결과를 한글(HWP)에 표 서식 그대로 붙여넣을 수 있는 HTML로 만든다.
 *
 * HWPX는 ZIP+OWPML 바이너리라 브라우저에서 생성하면 한글에서 열리지 않을 위험이 크고
 * 한컴오피스 없이는 검증도 어렵다. 반면 한글은 HTML 클립보드(text/html)를 붙여넣을 때
 * 표를 진짜 표로 받아들이고, .doc 확장자의 HTML 파일도 문서로 연다. 실무에서 필요한
 * 동작("표를 보고서에 붙여넣기")은 이 경로로 충분히, 그리고 검증 가능하게 해결된다.
 *
 * 한글이 안정적으로 해석하는 범위만 쓴다 — 인라인 스타일, 테두리 속성, 기본 태그.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CELL = "border:1px solid #333;padding:4px 8px;";
const HEAD_CELL = `${CELL}background:#eee;font-weight:bold;`;

export function buildHwpHtmlReport(input: ReportInput): string {
  const topCount = input.topCount ?? 10;
  const top = input.rows.slice(0, topCount);
  const totalCount = input.totalCount ?? input.rows.length;
  const parts: string[] = [];

  parts.push(`<h1 style="font-size:16pt;">${escapeHtml(input.title)}</h1>`);

  parts.push("<ul>");
  parts.push(`<li>기준월: ${escapeHtml(input.referenceMonth)}</li>`);
  parts.push(`<li>자료출처: ${escapeHtml(input.source)}</li>`);
  parts.push(`<li>데이터모드: ${escapeHtml(input.mode)}</li>`);
  if (input.exportedAt) parts.push(`<li>작성시각: ${escapeHtml(input.exportedAt)}</li>`);
  parts.push("</ul>");

  parts.push('<h2 style="font-size:13pt;">분석 요약</h2>');
  parts.push("<ul>");
  parts.push(`<li>${escapeHtml(toNounEnding(input.summary))}</li>`);
  parts.push(
    `<li>대상 행정동 ${totalCount.toLocaleString("ko-KR")}개 중 상위 ${top.length}개 제시</li>`,
  );
  parts.push("</ul>");

  parts.push(`<h2 style="font-size:13pt;">상위 ${top.length}개 지역</h2>`);
  if (top.length === 0) {
    parts.push("<ul><li>표시할 순위 없음</li></ul>");
  } else {
    parts.push('<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;">');
    parts.push(
      `<tr><th style="${HEAD_CELL}">순위</th><th style="${HEAD_CELL}">지역</th>` +
        `<th style="${HEAD_CELL}">값</th><th style="${HEAD_CELL}">비고</th></tr>`,
    );
    for (const row of top) {
      parts.push(
        `<tr><td style="${CELL}text-align:right;">${row.rank}</td>` +
          `<td style="${CELL}">${escapeHtml(row.name)}</td>` +
          `<td style="${CELL}">${escapeHtml(row.valueLabel)}</td>` +
          `<td style="${CELL}">${escapeHtml(row.note)}</td></tr>`,
      );
    }
    parts.push("</table>");
  }

  if (input.formulaNotes.length > 0) {
    parts.push('<h2 style="font-size:13pt;">산식 및 해석 기준</h2>');
    parts.push("<ul>");
    for (const note of input.formulaNotes) parts.push(`<li>${escapeHtml(note)}</li>`);
    parts.push("</ul>");
  }

  parts.push('<h2 style="font-size:13pt;">유의사항</h2>');
  parts.push("<ul>");
  parts.push("<li>순위는 기준월 단일 시점 값이며 추세 판단에는 다월 비교 필요</li>");
  parts.push("<li>절대값 지표는 인구·상권 규모에 좌우되므로 비율 지표와 병행 해석 필요</li>");
  parts.push("</ul>");

  // 한글이 인코딩을 오인하지 않도록 charset을 명시한 완전한 문서로 감싼다.
  return [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head><meta charset="utf-8"><title>',
    escapeHtml(input.title),
    "</title></head>",
    '<body style="font-family:\'맑은 고딕\',Malgun Gothic,sans-serif;font-size:11pt;">',
    parts.join("\n"),
    "</body></html>",
  ].join("");
}

/**
 * 서식 있는 표를 클립보드에 넣는다. text/html과 text/plain을 함께 실어, 한글·워드에는
 * 표로, 메모장 같은 평문 편집기에는 텍스트로 붙게 한다.
 * ClipboardItem을 지원하지 않는 브라우저에서는 false를 돌려 호출부가 대안을 쓰게 한다.
 */
export async function copyHtmlToClipboard(html: string, plainText: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    if (typeof ClipboardItem === "undefined") {
      await navigator.clipboard.writeText(plainText);
      return false;
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
