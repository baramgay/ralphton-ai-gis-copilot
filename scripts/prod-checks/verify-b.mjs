import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";
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
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => "")).replace("한 줄 결론복사", ""),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

const CASES = [
  // #1 군 축약 — 10개 군 전부
  ...["의령", "함안", "창녕", "고성", "남해", "하동", "산청", "함양", "거창", "합천"].map((g) => [
    `${g} 카드매출 높은 곳`,
    (r) => new RegExp(`${g}군 안`).test(r.notice),
    `군 축약(${g})`,
  ]),
  // #6 "준"
  ["작년보다 소비 늘고 인구 준 동", (r) => /추세 교차|증가.*감소|감소.*증가/.test(r.notice), "줄다 축약"],
  ["소득 수준 늘고 생활인구 기준 늘어나는 동", (r) => !/감소/.test(r.notice), "수준·기준 오독 방지"],
  // #7 의료 교차
  ["의료도 부족하고 소비도 적은 곳 5곳만", (r) => /의료/.test(r.notice), "조사 낀 교차 조건"],
  // 회귀 감시
  ["창원 생활인구 많은 동", (r) => /창원시 안/.test(r.notice), "회귀: 시 축약"],
  ["김해 소득 낮은 동", (r) => /김해시 안/.test(r.notice), "회귀: 시 축약"],
  ["격자로 봤을 때 소득 낮은 블록", (r) => /500m 격자 단위/.test(r.notice), "회귀: 격자(배치 A)"],
  ["주말에 사람 몰리는 곳", (r) => /답할 수 없습니다/.test(r.notice), "회귀: 없는 차원(배치 A)"],
  ["생활인구 대비 카드매출 적은 동", (r) => /교차분석/.test(r.notice), "회귀: 기존 교차"],
  ["카드매출 높은 곳", (r) => !/ 안 /.test(r.notice), "회귀: 지역 미지정은 전역"],
];

let pass = 0;
const failures = [];
for (const [q, check, why] of CASES) {
  const r = await ask(q);
  const ok = check(r);
  if (ok) pass += 1;
  else failures.push({ q, why, notice: r.notice, conclusion: r.conclusion });
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} (${r.rows}행)`);
  console.log(`    안내 ${r.notice.slice(0, 130)}`);
}
if (failures.length) {
  console.log("\n=== 어긋난 것 ===");
  for (const f of failures) {
    console.log(`질의: "${f.q}" (${f.why})`);
    console.log(`  안내: ${f.notice}`);
    console.log(`  결론: ${f.conclusion.slice(0, 160)}`);
  }
}
console.log(`\n통과 ${pass}/${CASES.length} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === CASES.length && errors.length === 0 ? 0 : 1);
