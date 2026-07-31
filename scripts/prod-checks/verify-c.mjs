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
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => "")).replace("한 줄 결론복사", ""),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

const CASES = [
  // #4 없는 시설
  ["1km 안에 편의점 많은 동", (r) => /편의점.*없습니다/.test(r.notice), "없는 시설"],
  ["학교 근처 소비 많은 동", (r) => /학교.*없습니다/.test(r.notice), "없는 시설(근처)"],
  ["터미널 근처 카드매출 높은 곳", (r) => /터미널.*없습니다/.test(r.notice), "없는 시설(근처)"],
  ["군부대 근처 상권", (r) => /군부대.*없습니다/.test(r.notice), "없는 시설(근처)"],
  // #8 #9 비슷하지만 다른 지표
  ["1인가구 많고 소득 낮은 동", (r) => /1인가구 비율/.test(r.notice) && !/지표가 없습니다/.test(r.notice), "1인가구는 답한다"],
  ["단독가구 많은 곳", (r) => /1인가구 비율/.test(r.notice), "1인가구 동의어"],
  ["세대수 많은 동", (r) => !/지표가 없습니다/.test(r.notice), "세대수는 막지 않는다"],
  ["출산율 높은 지역", (r) => /출산율 지표가 없습니다/.test(r.notice), "출산율 ≠ 출생 수"],
  // #5 3지역
  ["창원 김해 진주 중 어디가 나은가", (r) => /진주.*빠졌습니다/.test(r.notice), "3지역 절단 고지"],
  ["창원이랑 김해 중 어디가 나은가", (r) => !/빠졌습니다/.test(r.notice), "2지역은 고지 없음"],
  // 회귀 — 의료기관은 계속 되어야 한다
  ["2km 안에 병원 많은 동", (r) => !/없습니다/.test(r.notice) && r.rows > 0, "회귀: 의료 반경검색"],
  ["약국 없는 동네", (r) => !/위치 데이터가 없습니다/.test(r.notice), "회귀: 약국"],
  ["의료도 부족하고 소비도 적은 곳 5곳만", (r) => /의료/.test(r.notice), "회귀: 교차(배치 B)"],
  ["거창 카드매출 높은 곳", (r) => /거창군 안/.test(r.notice), "회귀: 군 축약(배치 B)"],
  ["격자로 봤을 때 소득 낮은 블록", (r) => /500m 격자 단위/.test(r.notice), "회귀: 격자(배치 A)"],
  ["생활인구 많은 동", (r) => r.rows > 0 && /생활인구/.test(r.notice), "회귀: 기본"],
];

let pass = 0;
const failures = [];
for (const [q, check, why] of CASES) {
  const r = await ask(q);
  const ok = check(r);
  if (ok) pass += 1;
  else failures.push({ q, why, notice: r.notice, conclusion: r.conclusion });
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} (${r.rows}행)`);
  console.log(`    안내 ${r.notice.slice(0, 140)}`);
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
