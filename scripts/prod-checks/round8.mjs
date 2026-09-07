import { chromium } from "@playwright/test";
const URL = "https://gnbc.site";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const ask = async (q) => {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(2600);
  return {
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    title: clean(await page.locator("[data-testid=result-panel] h2").first().textContent({ timeout: 1500 }).catch(() => "")),
    method: clean(await page.getByTestId("method-summary").textContent({ timeout: 1500 }).catch(() => "")),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};
const CASES = [
  ["3지표 나열", "생활인구 카드매출 평균소득", 3],
  ["3지표 방향혼합", "생활인구 많고 평균소득 높고 연체율 낮은 동", 3],
  ["4지표", "생활인구 카드매출 평균소득 신용평점", 4],
  ["2지표 유지", "소득 대비 소비가 과한 지역", 2],
  ["1지표 유지", "생활인구 많은 동", 1],
];
for (const [kind, q, n] of CASES) {
  const r = await ask(q);
  const isMulti = /다중조건/.test(r.title) || /다중조건/.test(r.notice);
  const isCross = /교차분석/.test(r.title);
  const ok = n >= 3 ? isMulti && r.rows > 0 : n === 2 ? isCross : !isMulti && !isCross && r.rows > 0;
  console.log(`${ok ? "✓" : "✗"} [${kind}] ${q} (${r.rows}행)`);
  console.log(`    제목 ${r.title.slice(0, 80)}`);
  console.log(`    산식 ${r.method.slice(0, 100)}`);
}
console.log(`\nJS 에러 ${errors.length}건`);
await browser.close();
