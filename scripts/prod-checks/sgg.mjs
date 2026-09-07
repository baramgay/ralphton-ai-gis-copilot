import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
for (const q of [
  "총인구 많은 시군구",
  "고령비율 높은 시군구",
  "세대수 많은 시군구",
  "출생 많은 시군구",
  "1인가구 많은 시군구",
  "의료 취약한 시군구",
  "카드매출 높은 시군구",
  "생활인구 많은 시군구",
]) {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1800);
  const notice = clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => ""));
  const first = clean(await page.locator(".rank-name").first().textContent({ timeout: 1500 }).catch(() => ""));
  const sgg = !/[읍면동]$/.test(first) && first.length > 0;
  console.log(`${sgg ? "✓시군구" : "✗행정동"} [${q}] 1위=${first}`);
  console.log(`    ${notice.slice(0, 90)}`);
}
await browser.close();
