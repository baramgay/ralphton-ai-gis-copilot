/**
 * Kimi 외부 검증 — 항목 7: 배포본 대조 (prod, 읽기 전용)
 *
 * 실행: node scripts/kimi-review/7-prod-probe.mjs
 *
 * 확인: 콘솔 에러 0인지 · 「재정자립도와 빈집 비율의 상관관계」의 표본 문구 ·
 * 「화재 많은 시군구」의 KOSIS 도달 · 지점 분석 클릭(시내/바다)의 행정동 판정.
 */
import { chromium } from "playwright";

const BASE = "https://ralphton-ai-gis-copilot.vercel.app/";

const consoleErrors = [];
const pageErrors = [];

async function ask(page, query) {
  const input = page.locator("#analysis-query");
  await input.fill(query);
  await page.locator(".query-hero-submit").click();
  // 결과 패널 텍스트가 바뀔 때까지 — 로딩이 길 수 있으니 넉넉히
  await page.waitForTimeout(9000);
  const panel = page.locator('[data-testid="result-panel"]');
  const text = (await panel.allTextContents()).join(" ").replace(/\s+/g, " ");
  const interp = page.locator('[data-testid="interpretation-card"]');
  const interpText = (await interp.allTextContents()).join(" ").replace(/\s+/g, " ");
  return `${interpText} ${text}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});
page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 200)));

console.log("== 7-0. 로드 ==");
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator('[data-testid="copilot-shell"]').waitFor({ timeout: 90_000 });
console.log("셸 로드됨. 현재 콘솔 에러:", consoleErrors.length, "페이지 에러:", pageErrors.length);

console.log("\n== 7-1. 「재정자립도와 빈집 비율의 상관관계」 ==");
const t1 = await ask(page, "재정자립도와 빈집 비율의 상관관계");
const m1 = t1.match(/표본\s*\d+개\s*시군구/g);
console.log("표본 문구:", m1 ? m1.join(" | ") : "없음");
console.log("창원 표기:", t1.includes("창원시") ? "있음" : "없음", "| 「개 구 공통값」:", (t1.match(/\d개 구 공통값/g) || []).join(",") || "없음");
console.log("계수 문구:", (t1.match(/피어슨[^·]*·[^·]*스피어만[^·]*/g) || ["없음"])[0]?.slice(0, 120));
console.log("본문 앞 300자:", t1.slice(0, 300));

console.log("\n== 7-2. 「화재 많은 시군구」 ==");
const t2 = await ask(page, "화재 많은 시군구");
console.log("화재/KOSIS 도달:", /화재|만명당/.test(t2) ? "예" : "아니오", "| 본문 앞 250자:", t2.slice(0, 250));

console.log("\n== 7-3. 지점 분석 클릭 ==");
const probeToggle = page.locator('button[aria-pressed]', { hasText: "지점 분석" });
if (await probeToggle.count()) {
  await probeToggle.first().click();
  await page.waitForTimeout(500);
  const map = page.locator(".kakao-map, #map, [class*=map]").last();
  const box = await page.locator("body").boundingBox();
  // 지도 중앙 부근(창원 시내가 기본 뷰라고 가정) 클릭
  await page.mouse.click(box.width * 0.5, box.height * 0.45);
  await page.waitForTimeout(2500);
  const card = page.locator('[aria-label="지점 분석 결과"]');
  if (await card.count()) {
    console.log("시내 클릭 카드:", ((await card.allTextContents()).join(" ")).replace(/\s+/g, " ").slice(0, 300));
  } else {
    console.log("시내 클릭: 카드가 안 떴다");
  }
} else {
  console.log("지점 분석 토글을 못 찾음");
}

console.log("\n== 콘솔/페이지 에러 ==");
console.log("console.error", consoleErrors.length, "건:", consoleErrors.slice(0, 5));
console.log("pageerror", pageErrors.length, "건:", pageErrors.slice(0, 5));

await browser.close();
