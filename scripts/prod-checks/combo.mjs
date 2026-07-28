import { chromium } from "@playwright/test";
await new Promise(r=>setTimeout(r, Number(process.env.WAIT_MS ?? 170000)));
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1400,height:900}})).newPage();
await p.goto("https://ralphton-ai-gis-copilot.vercel.app");
await p.getByRole("heading",{name:/경남 AI GIS/i}).waitFor({timeout:90000});
await p.getByRole("button",{name:"바로 시작"}).click().catch(()=>{});
await p.waitForTimeout(4000);
const clean=(t)=>(t??"").replace(/\s+/g," ").trim();
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
  const n = clean(await p.getByTestId("query-notice").textContent().catch(()=>""));
  const c = clean(await p.getByTestId("query-caveat").textContent().catch(()=>""));
  const rows = (await p.locator(".rank-row").allTextContents()).length;
  const v = clean(await p.locator(".rank-value").first().textContent().catch(()=>""));
  console.log(`[${q}] ${rows}행 1위값=${v}`);
  console.log(`    안내 ${n.slice(0,100)}`);
  if (c) console.log(`    고지 ${c.slice(0,130)}`);
}
await b.close();
