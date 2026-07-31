import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";

/**
 * 화면 1위가 큐브에서 독립 계산한 1위와 같은지 전 지표에서 확인한다.
 * "답이 나온다"와 "답이 맞다"는 다르다 — 라우팅만 보면 값이 틀려도 통과한다.
 */
const CASES = [
  ["생활인구 많은 동", "skt-living", "living_total"],
  ["생활인구 고령 비중 높은 동", "skt-living", "elderly_ratio"],
  ["유입인구 많은 동", "skt-mobility", "inflow_total"],
  ["유출인구 많은 동", "skt-mobility", "outflow_total"],
  ["순유입 큰 지역", "skt-mobility", "net_flow"],
  ["주간인구 많은 동", "skt-daynight", "day_population"],
  ["야간인구 많은 동", "skt-daynight", "night_population"],
  ["주야간 비율 높은 곳", "skt-daynight", "day_night_ratio"],
  ["카드매출 높은 동", "nh-consumption", "card_sales"],
  ["결제 건수 많은 동", "nh-consumption", "card_txns"],
  ["청년 소비 비중 높은 동", "nh-demographics", "youth_share"],
  ["중장년 소비 많은 지역", "nh-demographics", "middle_share"],
  ["고령 소비 비중 높은 동", "nh-demographics", "senior_share"],
  ["여성 소비 비중 높은 곳", "nh-demographics", "female_share"],
  ["법인카드 비중 높은 동", "nh-demographics", "corporate_share"],
  ["주간 매출 높은 동", "nh-hourly", "day_sales"],
  ["야간 매출 높은 동", "nh-hourly", "night_sales"],
  ["야간 소비비중 높은 곳", "nh-hourly", "night_share"],
  ["음식·숙박 비중 높은 동", "nh-industry", "food_share"],
  ["도소매 비중 높은 동", "nh-industry", "retail_share"],
  ["의료 소비 비중 높은 동", "nh-industry", "health_share"],
  ["여가 소비 비중 높은 동", "nh-industry", "leisure_share"],
  ["학원 소비 많은 동", "nh-industry", "education_share"],
  ["음식점 비중 높은 동", "nh-storetype", "restaurant_share"],
  ["카페 상권 발달한 동", "nh-storetype", "cafe_share"],
  ["유흥 상권 발달한 동", "nh-storetype", "pub_share"],
  ["편의점 비중 높은 동", "nh-storetype", "grocery_share"],
  ["주유소 비중 높은 동", "nh-storetype", "fuel_share"],
  ["약국 비중 높은 곳", "nh-storetype", "medical_store_share"],
  ["평균소득 높은 동", "kcb-credit", "avg_income"],
  ["신용평점 높은 동", "kcb-credit", "credit_score"],
  ["1인 카드소비 상위", "kcb-credit", "card_spend"],
  ["대출 많은 동", "kcb-credit", "loan_ratio"],
  ["연체율 높은 동", "kcb-credit", "delinquency_ratio"],
  ["하이엔드 비율 높은 동", "kcb-credit", "highend_ratio"],
  ["전입 많은 동", "kcb-migration", "move_in"],
  ["일자리 많은 동", "kcb-commute", "jobs_in"],
  ["일자리 배율 높은 동", "kcb-commute", "job_ratio"],
  ["관외 통근율 높은 동", "kcb-commute", "outbound_ratio"],
  ["격자 인구 많은 곳", "kcb-grid-500m", "pop_total"],
  ["격자 소득 높은 블록", "kcb-grid-500m", "avg_income"],
  ["격자 신용평점 높은 곳", "kcb-grid-500m", "credit_score"],
  ["격자 1인 카드소비 상위", "kcb-grid-500m", "card_spend"],
  ["격자 대출 많은 곳", "kcb-grid-500m", "loan_ratio"],
  ["격자 연체 높은 곳", "kcb-grid-500m", "delinquency_ratio"],
  ["격자 하이엔드 비율 높은 곳", "kcb-grid-500m", "highend_ratio"],
];

const cubes = {};
for (const id of [...new Set(CASES.map((c) => c[1]))]) {
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
let pass = 0;
for (const [query, layerId, metricKey] of CASES) {
  const cube = cubes[layerId];
  const idx = cube.months.indexOf(cube.referenceMonth);
  const ranked = cube.cells
    .map((c) => ({ name: c.name.replace(/^경상남도\s*/, ""), v: c.series[metricKey]?.[idx] }))
    .filter((r) => r.v != null)
    .sort((a, b) => b.v - a.v);
  const top = ranked[0];

  await page.getByLabel("분석 질의").fill(query);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1400);
  const first = clean((await page.locator(".rank-row").first().textContent({ timeout: 1500 }).catch(() => "")) ?? "");
  /*
   * 이름과 값은 각각의 요소에서 읽는다. 행 전체 textContent를 정규식으로 훑으면 격자처럼
   * 숫자로 끝나는 이름이 값과 이어붙어("…격자 6" + "12,893명" → 612,893) 없는 숫자가
   * 생긴다. 값 자체는 맞는데 검증이 틀리는 것이라, 실제 결함을 가리게 된다.
   */
  const row = page.locator(".rank-row").first();
  const nameText = clean((await row.locator(".rank-name").textContent({ timeout: 1500 }).catch(() => "")) ?? "");
  const valueText = clean((await row.locator(".rank-value").textContent({ timeout: 1500 }).catch(() => "")) ?? "");

  const lastWord = top.name.split(" ").pop();
  const nameOk = nameText.includes(lastWord);
  const nums = [...valueText.matchAll(/([\d,]+\.?\d*)/g)].map((m) => Number(m[1].replaceAll(",", "")));
  const valOk = nums.some((n) => Math.abs(n - top.v) / Math.max(1, Math.abs(top.v)) < 0.02);
  const ok = nameOk && valOk;
  if (ok) pass += 1;
  else {
    console.log(`✗ ${query}`);
    console.log(`    큐브 1위 ${top.name} = ${top.v}`);
    console.log(`    화면    ${first.slice(0, 90)}`);
  }
}
console.log(`\n${pass}/${CASES.length} 값 일치 · JS 에러 ${errors.length}건`);
await browser.close();
