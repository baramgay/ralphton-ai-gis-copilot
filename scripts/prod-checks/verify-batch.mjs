import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const WAIT_MS = Number(process.env.WAIT_MS ?? 150_000);
process.stdout.write(`배포 대기 ${WAIT_MS / 1000}초...\n`);
await new Promise((r) => setTimeout(r, WAIT_MS));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
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
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

// [질의, 통과 조건(안내에 대한 검사), 설명]
const CASES = [
  ["격자로 봤을 때 소득 낮은 블록", (n) => /500m 격자/.test(n) && /격자 평균소득/.test(n), "격자 단위 요구"],
  ["격자에서 소득 낮은 곳", (n) => /500m 격자/.test(n), "격자 단위 요구"],
  ["격자 단위로 소득 낮은 곳", (n) => /500m 격자/.test(n), "격자 단위 요구"],
  ["소득 낮은 격자", (n) => /500m 격자/.test(n), "격자 단위 요구"],
  ["격자로 보면 소득 낮은 곳", (n) => /500m 격자/.test(n), "격자 단위 요구"],
  ["격자 소득 낮은 블록", (n) => /500m 격자 단위/.test(n), "안내의 단위 표기"],
  ["의료도 부족하고 소비도 적은 곳 5곳만", (n) => /의료/.test(n), "조사 낀 조건"],
  ["주말에 사람 몰리는 곳", (n) => /답할 수 없습니다/.test(n), "없는 차원 → 멈춤"],
  ["평일 낮에 붐비는 동네", (n) => /답할 수 없습니다/.test(n), "없는 차원 → 멈춤"],
  ["주말 여는 약국", (n) => !/답할 수 없습니다/.test(n), "시설 검색은 통과"],
  // 회귀 감시: 예전에 잘 되던 것이 그대로인가
  ["소득 낮은 동", (n) => /행정동 단위/.test(n) && !/격자/.test(n), "회귀: 행정동 그대로"],
  ["생활인구 많은 동", (n) => /생활인구/.test(n), "회귀: 생활인구"],
];

let pass = 0;
for (const [q, check, why] of CASES) {
  const r = await ask(q);
  const ok = check(r.notice);
  if (ok) pass += 1;
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} (${r.rows}행)`);
  console.log(`    안내 ${r.notice.slice(0, 120)}`);
  if (!ok) console.log(`    결론 ${r.conclusion.slice(0, 120)}`);
}
console.log(`\n통과 ${pass}/${CASES.length} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === CASES.length && errors.length === 0 ? 0 : 1);
