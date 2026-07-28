import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
for (const q of [
  "세대수 많은 동",
  "세대 많은 동",
  "가구 수 많은 읍면동",
  "세대수 많은 시군구",
  "총인구 많은 동",
  "고령비율 높은 동",
  "출생 많은 동",
]) {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1800);
  const notice = clean(await page.getByTestId("query-notice").textContent().catch(() => ""));
  const stale = await page.getByTestId("stale-answer-notice").isVisible().catch(() => false);
  console.log(`[${q}] ${stale ? "★답못함" : "답함"}`);
  console.log(`    ${notice.slice(0, 120)}`);
}
await browser.close();
