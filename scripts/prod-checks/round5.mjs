import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";
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
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => "")).replace("한 줄 결론복사", ""),
    stale: await page.getByTestId("stale-answer-notice").isVisible().catch(() => false),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

// 실무자가 실제로 물을 정책 시나리오 + 아직 안 밟은 조합
const CASES = [
  ["정책", "청년 정책 대상지로 볼 만한 동은 어디인가"],
  ["정책", "소비가 줄고 있는데 인구는 늘고 있는 동네"],
  ["정책", "고령 인구가 많은데 의료도 부족하고 소득도 낮은 곳"],
  ["정책", "상권이 성장하는 읍면동 상위"],
  ["격자추세", "격자 소득 늘어나는 블록"],
  ["교차기간", "최근 6개월 생활인구는 늘고 카드매출도 느는 동"],
  ["시군구교차", "시군구별 소득 높고 소비도 많은 곳"],
  ["시군구방향", "시군구별 연체율 낮은 곳"],
  ["삼중", "생활인구 카드매출 평균소득"],
  ["단위혼합", "창원시 성산구 격자 소득 높은 블록"],
  ["부정", "카드매출이 없는 동"],
  ["기간변형", "작년 대비 생활인구 늘어난 곳"],
];

let answered = 0;
let asked = 0;
for (const [kind, q] of CASES) {
  const r = await ask(q);
  const suggested = /혹시.*인가요/.test(r.notice);
  const ok = !r.stale && r.rows > 0 && !/분석을 실행하는 중|다시 시도해/.test(r.notice);
  if (ok) answered += 1;
  else if (suggested) asked += 1;
  const mark = ok ? "✓" : suggested ? "?" : "✗";
  console.log(`${mark} [${kind}] ${q} (${r.rows}행)`);
  console.log(`    안내 ${r.notice.slice(0, 110)}`);
  console.log(`    결론 ${r.conclusion.slice(0, 110)}`);
}
console.log(`\n답함 ${answered} · 되물음 ${asked} · 실패 ${CASES.length - answered - asked} / ${CASES.length}`);
console.log(`JS 에러 ${errors.length}건`);
await browser.close();
