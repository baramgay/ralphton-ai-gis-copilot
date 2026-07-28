import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const ask = async (q) => {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1800);
  return {
    notice: clean(await page.getByTestId("query-notice").textContent().catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent().catch(() => "")).replace("한 줄 결론복사", ""),
    stale: await page.getByTestId("stale-answer-notice").isVisible().catch(() => false),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

const CASES = [
  ["비교", "창원과 김해 카드매출 비교"],
  ["인구통계", "20대 여성 소비 많은 곳"],
  ["시간대", "점심 시간 매출 높은 동"],
  ["시간대", "밤 늦게 장사되는 곳"],
  ["업종", "학원가 형성된 동"],
  ["업종", "술집 많은 동네"],
  ["격자교차", "격자 소득 높고 소비도 많은 블록"],
  ["격자방향", "격자 인구 적은 칸"],
  ["복합", "김해에서 생활인구는 느는데 소비는 주는 동"],
  ["복합", "시군구별 전입 늘고 소득도 늘어나는 곳"],
  ["단순", "제일 잘 사는 동네"],
  ["단순", "가장 가난한 지역"],
  ["단순", "일자리 많은 시군구"],
  ["의료", "약국 없는 동"],
];

let answered = 0;
let asked = 0;
for (const [kind, q] of CASES) {
  const r = await ask(q);
  const suggested = /혹시.*인가요/.test(r.notice);
  const ok = !r.stale && r.rows > 0 && !/분석을 실행하는 중|다시 시도해/.test(r.notice);
  if (ok) answered += 1;
  else if (suggested) asked += 1;
  console.log(`${ok ? "✓" : suggested ? "?" : "✗"} [${kind}] ${q} (${r.rows}행)`);
  console.log(`    안내 ${r.notice.slice(0, 110)}`);
  console.log(`    결론 ${r.conclusion.slice(0, 110)}`);
}
console.log(`\n답함 ${answered} · 되물음 ${asked} · 실패 ${CASES.length - answered - asked} / ${CASES.length}`);
console.log(`JS 에러 ${errors.length}건`);
await browser.close();
