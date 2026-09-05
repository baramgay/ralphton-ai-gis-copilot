/*
 * A4 보고서가 **실제로 종이에서 어떻게 되는지** 본다.
 *
 * 지금까지 이 부분은 코드로만 확인돼 있었다 — `thead { display: table-header-group }`과
 * `tr { break-inside: avoid }`가 CSS에 있다는 것. 그러나 선언이 있다는 것과 종이에서
 * 무너지지 않는다는 것은 다른 말이고, 「헤드리스로는 못 본다」는 이유로 계속 미뤄져 있었다.
 *
 * ## 사람 눈 없이 어떻게 가리는가
 *
 * PDF 안의 한글은 글꼴 부분집합의 코드로 들어가 그대로 읽을 수 없다. 그래서 읽는 대신
 * **비교한다** — 같은 보고서를 머리글 반복만 끈 채로 한 번 더 찍어, 글자를 그리는 명령
 * (Tj/TJ) 수를 센다. 규칙이 실제로 걸렸다면 정상본이 열 이름 칸 수만큼 더 많다. 규칙이
 * 헛돌면 두 수가 같다. 「선언이 있다」가 아니라 **「그 선언이 종이를 바꾼다」**를 재는 것이다.
 *
 * 만들어진 PDF 두 개는 지우지 않고 남긴다 — 눈으로 볼 사람이 열 수 있게.
 *
 * 실행: node scripts/verify-a4-print.mjs (종료 코드로 판정)
 */
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { chromium } from "@playwright/test";
import { createJiti } from "jiti";

/*
 * 보고서 빌더는 TS이고 `@/` 별칭을 쓴다. 여기서 다시 구현하면 그것은 **다른 보고서**를
 * 재는 검사가 되므로, jiti로 실제 모듈을 그대로 불러온다.
 */
const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { buildA4HtmlReport } = await jiti.import("../src/lib/analysis/export-a4.ts");

const outDir = mkdtempSync(join(tmpdir(), "ralphton-a4-"));

/** 화면이 실제로 내보내는 모양 그대로. 행 수는 A4 기본값(상위 20건)에 맞춘다. */
const rows = Array.from({ length: 20 }, (_, index) => ({
  rank: index + 1,
  code: `48${String(120 + index).padStart(3, "0")}`,
  sido: "경남",
  name: ["창원시", "김해시", "양산시", "진주시", "거제시", "통영시", "사천시", "밀양시"][index % 8],
  valueLabel: `${(30 - index * 0.7).toFixed(2)}%`,
  note: `재정자립도 ${(30 - index * 0.7).toFixed(2)}% · 빈집 비율 ${(6 + index * 0.3).toFixed(2)}%`,
}));

const input = {
  title: "재정자립도 × 빈집 비율 관계",
  summary: "18개 시군구에서 강하게 반대로 움직이는 경향입니다 (스피어만 ρ -0.75).",
  referenceMonth: "2025-12",
  source: "KOSIS 재정자립도 × 빈집 비율",
  mode: "live",
  formulaNotes: [
    "피어슨 r = -0.888 · 스피어만 ρ = -0.754 · 표본 18개 시군구",
    "창원시 5개 구는 원자료가 시 단위라 소속 구의 값이 모두 같습니다. 같은 값을 여러 번 세면 그 도시가 계수를 그만큼 더 끌어당기므로 1곳으로 셌습니다.",
    "두 지표 중 하나가 시군구까지만 제공되어 시군구 단위로 계산했습니다. 읍면동으로 계산하면 같은 값이 반복 집계되어 표본 수가 부풀려집니다.",
    "기준 시점이 다릅니다 — 재정자립도는 2024-12, 빈집 비율은 2025-12 값입니다.",
    "상관은 인과가 아닙니다. 함께 움직인다는 것이 한쪽이 다른 쪽을 만든다는 뜻은 아닙니다.",
  ],
  rows,
  totalCount: 18,
  exportedAt: "2026-09-05 10:00",
};

const html = buildA4HtmlReport(input);
/** 대조본: 머리글 반복만 끈다. 나머지는 한 글자도 다르지 않다. */
const brokenHtml = html.replace(
  "</head>",
  "<style>thead { display: table-row-group !important; }</style></head>",
);

async function renderPdf(source, name) {
  const htmlPath = join(outDir, `${name}.html`);
  const pdfPath = join(outDir, `${name}.pdf`);
  writeFileSync(htmlPath, source, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath.split("\\").join("/")}`, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const measured = await page.evaluate(() => ({
    tableHeight: Math.round(document.querySelector("table")?.getBoundingClientRect().height ?? 0),
    headDisplay: getComputedStyle(document.querySelector("thead")).display,
    rowBreak: getComputedStyle(document.querySelector("tbody tr")).breakInside,
    headerCells: document.querySelectorAll("thead th").length,
  }));
  await browser.close();
  return { htmlPath, pdfPath, measured };
}

/** PDF의 압축 스트림을 모두 풀어 글자 그리기 명령 수를 센다. */
function countTextRuns(pdfPath) {
  const buffer = readFileSync(pdfPath);
  const raw = buffer.toString("latin1");
  let runs = 0;
  let cursor = 0;
  for (;;) {
    const start = raw.indexOf("stream", cursor);
    if (start === -1) break;
    const from = raw[start + 6] === "\r" ? start + 8 : start + 7;
    const end = raw.indexOf("endstream", from);
    if (end === -1) break;
    cursor = end + 9;
    try {
      const text = inflateSync(buffer.subarray(from, end)).toString("latin1");
      runs += (text.match(/Tj|TJ/g) ?? []).length;
    } catch {
      // 압축이 아닌 스트림(글꼴 파일 등)은 건너뛴다.
    }
  }
  return runs;
}

function pageCount(pdfPath) {
  const pdf = readFileSync(pdfPath, "latin1");
  const declared = pdf.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  return declared ? Number(declared[1]) : (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

const good = await renderPdf(html, "report");
const broken = await renderPdf(brokenHtml, "report-no-repeat");

const pages = pageCount(good.pdfPath);
const goodRuns = countTextRuns(good.pdfPath);
const brokenRuns = countTextRuns(broken.pdfPath);

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log(`\n보고서 PDF: ${good.pdfPath}`);
console.log(`대조본    : ${broken.pdfPath}`);
console.log(`쪽 수 ${pages} · 표 높이 ${good.measured.tableHeight}px · 열 이름 ${good.measured.headerCells}칸\n`);

check(pages > 1, "표가 실제로 쪽을 넘어간다", `${pages}쪽 — 안 넘어가면 이 검사 자체가 헛돈다`);
check(good.measured.headDisplay === "table-header-group", "thead가 머리글 그룹", good.measured.headDisplay);
check(good.measured.rowBreak === "avoid", "행이 쪽 경계에서 안 갈린다", good.measured.rowBreak);
check(
  goodRuns > brokenRuns,
  "둘째 쪽에도 열 이름이 찍힌다",
  `글자 명령 ${goodRuns} vs 머리글 반복 끈 대조본 ${brokenRuns} (차이 ${goodRuns - brokenRuns})`,
);

console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
