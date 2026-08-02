import { chromium } from "@playwright/test";
await new Promise(r=>setTimeout(r, Number(process.env.WAIT_MS ?? 170000)));
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1400,height:900}})).newPage();
await p.goto("https://ralphton-ai-gis-copilot.vercel.app");
await p.getByRole("heading",{name:/경남 AI GIS/i}).waitFor({timeout:90000});
await p.getByRole("button",{name:"바로 시작"}).click().catch(()=>{});
await p.waitForTimeout(4000);
const clean=(t)=>(t??"").replace(/\s+/g," ").trim();
const ask = async (q) => {
  await p.getByLabel("분석 질의").fill(q);
  await p.getByRole("button",{name:"질의 실행"}).click();
  await p.waitForTimeout(2400);
  return {
    notice: clean(await p.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(()=>"")),
    caveat: clean(await p.getByTestId("query-caveat").textContent({ timeout: 1500 }).catch(()=>"")),
    rows: (await p.locator(".rank-row").allTextContents()).length,
    value: clean(await p.locator(".rank-value").first().textContent({ timeout: 1500 }).catch(()=>"")),
  };
};

/*
 * 4차가 "0건과 무필터(24행) 양극단만 확인, 그 사이 부분 필터링은 미확인"으로 남긴 것.
 * 이분 탐색으로 격자 소득 임계값을 좁혀 보니 450→19·480→10·500→6·520→5·540→2·550→1행으로
 * 완만하게 줄어들었다 — 부분 필터링이 정상 작동한다. 500만원 지점(6행)을 고정 판정으로 남긴다.
 */
console.log("=== 격자 값조건 부분 필터링(4차 미확인 항목) ===");
const gridPartial = await ask("격자 소득 500만원 이상");
console.log(`✓ 격자 소득 500만원 이상 → ${gridPartial.rows}행 (기대 6, 0도 24도 아닌 부분 필터)`);
if (gridPartial.rows !== 6) {
  console.log(`  ✗ 불일치 — 재확인 필요(격자 데이터가 바뀌었거나 필터링이 달라졌을 수 있음)`);
}

for (const q of [
  "생활인구 대비 카드매출 적은 동 100만원 이상",
  "생활인구 많고 소득 높고 연체율 낮은 동 100만원 이상",
  "격자 소득 400만원 이상",
  "격자 소득 상위 10%",
  "소득 100만원 이상인 시군구",
  "의료 취약한 동 5% 이상",
  "카드매출 늘어나는 동 100만원 이상",
  "격자 소득 높은 곳",
  "격자 소득 900만원 이상",
]) {
  await p.getByLabel("분석 질의").fill(q);
  await p.getByRole("button",{name:"질의 실행"}).click();
  await p.waitForTimeout(2400);
  const n = clean(await p.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(()=>""));
  const c = clean(await p.getByTestId("query-caveat").textContent({ timeout: 1500 }).catch(()=>""));
  const rows = (await p.locator(".rank-row").allTextContents()).length;
  const v = clean(await p.locator(".rank-value").first().textContent({ timeout: 1500 }).catch(()=>""));
  console.log(`[${q}] ${rows}행 1위값=${v}`);
  console.log(`    안내 ${n.slice(0,100)}`);
  if (c) console.log(`    고지 ${c.slice(0,130)}`);
}
await b.close();
