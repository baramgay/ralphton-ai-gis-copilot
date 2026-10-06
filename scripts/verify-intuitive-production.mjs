import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.UX_VERIFY_URL??'https://gnbc.site';
const browser=await chromium.launch();
const reports=[];
await mkdir('test-results/intuitive-production',{recursive:true});
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/api/usage/events',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  await context.addInitScript(()=>{localStorage.setItem('ralphton-onboard-v1','1');localStorage.setItem('ralphton-theme','light');document.addEventListener('securitypolicyviolation',e=>window.__cspBlocks=(window.__cspBlocks??[]).concat(e.blockedURI));});
  const page=await context.newPage();const errors=[];const blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByTestId('copilot-shell').waitFor({timeout:60000});
  const health=await page.evaluate(async()=>await (await fetch('/api/health')).json());
  assert(health.build.commitSha,'Production build SHA missing');
  if(process.env.EXPECTED_SHA) assert.equal(health.build.commitSha,process.env.EXPECTED_SHA);
  await page.waitForFunction(()=>typeof window.kakao?.maps?.Map==='function',{timeout:30000});
  const map=page.locator('[data-map-engine="kakao"]');await map.waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-map-engine="kakao"] img')).filter(n=>n.naturalWidth>=128).length>0);
  const loadedTiles=await map.locator('img').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>=128).length);
  const before=await map.locator('img').evaluateAll(nodes=>nodes.map(n=>n.src));
  const area=await map.boundingBox();await page.mouse.move(area.x+area.width*.7,area.y+area.height*.45);await page.mouse.wheel(0,-500);
  await page.waitForTimeout(1500);
  const after=await map.locator('img').evaluateAll(nodes=>nodes.map(n=>n.src));
  assert.notDeepEqual(after,before,'Kakao map must respond to zoom');
  await page.mouse.move(area.x+area.width*.65,area.y+area.height*.4);await page.mouse.down();await page.mouse.move(area.x+area.width*.65+60,area.y+area.height*.4+30,{steps:10});await page.mouse.up();
  const input=page.getByRole('textbox',{name:'분석 질의'});
  const run=async(query,expectedNotice='분석 완료')=>{
   await input.fill(query);await page.getByRole('button',{name:'질의 실행'}).click();
   try {await page.getByTestId('query-notice').filter({hasText:expectedNotice}).waitFor({timeout:30000});}
   catch(error){
    await page.screenshot({path:`test-results/intuitive-production/${width}-query-failure.png`});
    console.log(JSON.stringify({width,query,notice:await page.getByTestId('query-notice').innerText().catch(()=>null),caveat:await page.getByTestId('query-caveat').innerText().catch(()=>null)}));
    throw error;
   }
  };

  const openControls=async()=>{const toggle=page.getByRole('button',{name:'분석 설정',exact:true});if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();};
  await run('김해 생활인구 많은 동');await openControls();
  assert.match(await page.getByTestId('analysis-scope').innerText(),/김해/);
  await page.getByRole('button',{name:'자료 변경'}).click();
  await page.getByRole('searchbox',{name:'자료 검색'}).fill('카드소비');
  await page.getByRole('dialog').getByRole('button',{name:/^카드소비/}).click();
  assert.equal(await input.inputValue(),'');assert.match(await page.getByTestId('analysis-scope').innerText(),/경상남도 전체/);
  await run('진주시 최근 3개월 카드매출 증가하는 동');await openControls();
  const conditions=await page.getByTestId('executed-analysis-context').innerText();
  assert.match(conditions,/카드매출/);assert.match(conditions,/진주시/);assert.match(conditions,/최근 3개월/);
  assert.equal(await page.getByTestId('quick-radius').count(),0);
  assert(!/의료기관/.test(await page.getByTestId('dataset-selected').innerText()));
  await page.getByRole('button',{name:'자료 변경'}).click();await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.getByRole('button',{name:'자료 변경'}).evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:`test-results/intuitive-production/${width}-trend.png`});
  const icons=await page.locator('link[rel="icon"],link[rel="apple-touch-icon"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  for(const path of ['/favicon.svg','/favicon.ico','/favicon-96.png','/apple-touch-icon.png']) {
   assert(icons.some(icon=>icon?.startsWith(path)&&icon.includes('v=20261006-redesign')));
   const iconURL=icons.find(icon=>icon?.startsWith(path));
   assert.equal(await page.evaluate(async url=>(await fetch(url)).status,iconURL),200);
  }
  await page.getByRole('button',{name:'자료 변경'}).click();
  await page.getByRole('searchbox',{name:'자료 검색'}).fill('의료기관');
  await page.getByRole('dialog').getByRole('button',{name:/^의료기관/}).click();
  await page.getByRole('button',{name:'시군구',exact:true}).click();
  await run('김해에서 약국 보여줘','약국 위치를 지도에 표시했습니다.');await openControls();
  const quickTools=page.locator('.analysis-medical-tools');
  if(await quickTools.getAttribute('open')===null) await quickTools.locator('summary').click();
  await page.getByTestId('quick-growth').click();
  assert.equal(await input.inputValue(),'');
  const growthConditions=await page.getByTestId('executed-analysis-context').innerText();
  assert.match(growthConditions,/단위\s*행정동/);assert.match(growthConditions,/경상남도 전체/);
  assert.equal(await page.getByRole('button',{name:'1km 반경'}).count(),0);
  await page.getByTestId('executed-analysis-context').scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/intuitive-production/${width}-growth.png`});
  blocked.push(...await page.evaluate(()=>window.__cspBlocks??[]));
  assert.equal(errors.length,0);assert.equal(blocked.length,0);
  reports.push({width,commitSha:health.build.commitSha,loadedTiles,zoomChanged:true,conditions,growthConditions,icons,errors,blocked,usageEventsSent:false});
  await context.close();
 }
 await writeFile('logs/intuitive-production.json',JSON.stringify(reports,null,2));
 console.log(JSON.stringify({base,viewports:reports.length,failures:0,commitSha:reports[0].commitSha}));
} finally {await browser.close();}
