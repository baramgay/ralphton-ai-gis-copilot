import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";

const CASES = [
  // 역방향 — 낮은/적은을 물으면 뒤집혀야 한다
  ["역방향", "평균소득 낮은 동", "kcb-credit", "avg_income", "asc"],
  ["역방향", "생활인구 적은 곳", "skt-living", "living_total", "asc"],
  ["역방향", "카드매출 적은 지역", "nh-consumption", "card_sales", "asc"],
  ["역방향", "신용평점 낮은 동", "kcb-credit", "credit_score", "asc"],
  // 정방향 대조군
  ["정방향", "평균소득 높은 동", "kcb-credit", "avg_income", "desc"],
  ["정방향", "생활인구 많은 곳", "skt-living", "living_total", "desc"],
];

const EXTRA = [
  // 지역 한정
  ["지역한정", "창원 생활인구 많은 동"],
  ["지역한정", "김해 카드매출 높은 곳"],
  // 띄어쓰기·표기 변형
  ["표기변형", "생활 인구 많은 동"],
  ["표기변형", "카드 매출 높은 지역"],
  ["표기변형", "평균 소득 높은 동"],
  // 범위 밖
  ["범위밖", "서울 인구 많은 동"],
  ["범위밖", "부산 소득 높은 곳"],
  // 무의미
  ["무의미", "ㅁㄴㅇㄹ"],
  ["무의미", "안녕하세요"],
  ["무의미", "오늘 날씨 어때"],
];

const cubes = {};
for (const id of [...new Set(CASES.map((c) => c[2]))]) {
  cubes[id] = await (await fetch(`${URL}/data/layers/${id}.json`)).json();
}

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
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
  await page.waitForTimeout(1500);
  return {
    first: clean((await page.locator(".rank-row").first().textContent({ timeout: 1500 }).catch(() => "")) ?? ""),
    rows: (await page.locator(".rank-row").allTextContents()).length,
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    conclusion: clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => "")).replace("한 줄 결론복사", ""),
  };
};

console.log("=== 방향 ===");
for (const [kind, query, layerId, metricKey, want] of CASES) {
  const cube = cubes[layerId];
  const idx = cube.months.indexOf(cube.referenceMonth);
  const ranked = cube.cells
    .map((c) => ({ name: c.name.replace(/^경상남도\s*/, ""), v: c.series[metricKey]?.[idx] }))
    .filter((r) => r.v != null)
    .sort((a, b) => a.v - b.v);
  const expected = want === "asc" ? ranked[0] : ranked[ranked.length - 1];
  const r = await ask(query);
  const ok = r.first.includes(expected.name.split(" ").pop());
  console.log(`${ok ? "✓" : "✗"} [${kind}] ${query}`);
  if (!ok) {
    console.log(`    기대 1위(${want}) ${expected.name} = ${expected.v}`);
    console.log(`    화면 ${r.first.slice(0, 80)}`);
  }
}

console.log("\n=== 그 밖 ===");
for (const [kind, query] of EXTRA) {
  const r = await ask(query);
  console.log(`[${kind}] ${query} → ${r.rows}행`);
  console.log(`    안내 ${r.notice.slice(0, 100)}`);
  console.log(`    결론 ${r.conclusion.slice(0, 90)}`);
}
console.log(`\nJS 에러 ${errors.length}건`);
await browser.close();
