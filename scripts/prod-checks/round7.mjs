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
  await page.waitForTimeout(1900);
  return {
    meta: clean(await page.getByTestId("result-meta").textContent().catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent().catch(() => "")).replace("한 줄 결론복사", ""),
    rows: (await page.locator(".rank-row").allTextContents()).length,
    top: clean(await page.locator(".rank-row .rank-name").first().textContent().catch(() => "")),
    profile: clean(await page.getByTestId("region-profile").textContent().catch(() => "")).slice(0, 40),
  };
};

console.log("=== 개수 지정 ===");
for (const [q, want] of [
  ["생활인구 많은 동 상위 5곳만", 5],
  ["카드매출 높은 지역 3곳", 3],
  ["평균소득 높은 동 10개만", 10],
]) {
  const r = await ask(q);
  console.log(`${r.rows === want ? "✓" : "✗"} ${q} → ${r.rows}행 (기대 ${want})`);
}

console.log("\n=== 개수 아닌 숫자를 개수로 읽지 않는다 ===");
for (const q of ["최근 6개월 생활인구 늘어난 곳", "20대 여성 소비 많은 곳", "격자 소득 높은 블록"]) {
  const r = await ask(q);
  console.log(`${r.rows > 10 ? "✓" : "✗"} ${q} → ${r.rows}행 (잘리지 않아야 함)`);
}

console.log("\n=== 선택이 답을 따라간다 ===");
await ask("의료 취약 지역");
const r = await ask("생활인구 많은 동");
const rankOk = /선택 1위/.test(r.meta);
const nameKey = r.top.replace(/^경상남도\s*/, "");
const profileOk = !r.profile || r.profile.includes(nameKey);
console.log(`${rankOk ? "✓" : "✗"} 메타: ${r.meta}`);
console.log(`${profileOk ? "✓" : "✗"} 1위 ${r.top} / 프로파일 ${r.profile}`);
console.log(`    결론 ${r.conclusion.slice(0, 90)}`);

console.log(`\nJS 에러 ${errors.length}건`);
await browser.close();
