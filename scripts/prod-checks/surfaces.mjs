import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
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
};
const download = async (name) => {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.getByRole("button", { name: new RegExp(name) }).first().click(),
  ]);
  const stream = await dl.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString("utf-8");
  return { file: dl.suggestedFilename(), text };
};

// 1) 지역 한정 + 방향이 내보내기까지 이어지는가
console.log("=== 내보내기: 양산 생활인구 적은 동 ===");
await ask("양산 생활인구 적은 동");
const csv = await download("CSV");
const lines = csv.text.split(/\r?\n/).filter(Boolean);
const bodyStart = lines.findIndex((l) => l.startsWith("순위,"));
const body = lines.slice(bodyStart + 1);
console.log(`  ${csv.file} · 본문 ${body.length}행`);
console.log(`  1행 ${clean(body[0]).slice(0, 80)}`);
const nonYangsan = body.filter((l) => !l.includes("양산")).length;
console.log(`  ${nonYangsan === 0 ? "✓" : "✗"} 양산 밖 행 ${nonYangsan}개`);
const firstVal = Number((body[0].split(",")[4] ?? "").replace(/[^\d.]/g, ""));
const lastVal = Number((body[body.length - 1].split(",")[4] ?? "").replace(/[^\d.]/g, ""));
console.log(`  ${firstVal < lastVal ? "✓" : "✗"} 오름차순 (${firstVal} → ${lastVal})`);

const md = await download("보고서");
console.log(`  보고서 ${md.file}`);
const summaryLine = md.text.split("\n").find((l) => l.includes("대상")) ?? "";
console.log(`    ${clean(summaryLine).slice(0, 90)}`);
console.log(`    ${/입니다\.|습니다\./.test(md.text) ? "✗ 서술식 잔존" : "✓ 개조식"}`);

// 2) 격자 결과 내보내기
console.log("\n=== 내보내기: 격자 ===");
await ask("격자 소득 높은 블록");
const gridCsv = await download("CSV");
const gLines = gridCsv.text.split(/\r?\n/).filter(Boolean);
const gStart = gLines.findIndex((l) => l.startsWith("순위,"));
console.log(`  머리글 ${clean(gLines[gStart]).slice(0, 60)}`);
console.log(`  1행 ${clean(gLines[gStart + 1]).slice(0, 90)}`);

// 3) 지역 프로파일(선택 지역 종합)
console.log("\n=== 지역 프로파일 ===");
await ask("생활인구 많은 동");
const profileToggle = page.getByText(/민간데이터 종합/).first();
if (await profileToggle.isVisible().catch(() => false)) {
  await profileToggle.click();
  await page.waitForTimeout(800);
  const text = clean(await page.getByTestId("result-panel").textContent().catch(() => ""));
  const hasProviders = ["SKT", "NH", "KCB"].filter((p) => text.includes(p)).length;
  console.log(`  ✓ 프로파일 열림 · 제공사 ${hasProviders}/3 노출`);
} else {
  console.log("  ✗ 프로파일 토글을 찾지 못함");
}

// 4) 공유 링크 복원
console.log("\n=== 공유 링크 ===");
await ask("평균소득 낮은 동");
const before = clean(await page.getByTestId("one-line-conclusion").textContent().catch(() => ""));
await page.getByRole("button", { name: "공유" }).first().click();
await page.waitForTimeout(600);
const shareUrl = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
console.log(`  링크 ${shareUrl ? shareUrl.slice(0, 90) : "(클립보드 접근 불가)"}`);
if (shareUrl && shareUrl.startsWith("http")) {
  const page2 = await context.newPage();
  await page2.goto(shareUrl);
  await page2.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60_000 });
  await page2.waitForTimeout(3500);
  const after = clean(await page2.getByTestId("one-line-conclusion").textContent().catch(() => ""));
  console.log(`  ${after === before ? "✓" : "✗"} 복원 일치`);
  if (after !== before) {
    console.log(`    이전 ${before.slice(0, 80)}`);
    console.log(`    복원 ${after.slice(0, 80)}`);
  }
  await page2.close();
}

console.log(`\nJS 에러 ${errors.length}건`);
await browser.close();
