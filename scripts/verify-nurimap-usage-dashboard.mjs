import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const baseURL=process.argv[2]??'https://gnbc.site';
const password=(await readFile(process.argv[3]??'.vercel/nurimap-usage-admin.txt','utf8')).trim();
await mkdir('test-results/usage-dashboard',{recursive:true});
const browser=await chromium.launch();
const results=[];
try {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL+'/admin/usage');
  await page.getByLabel('관리자 비밀번호').waitFor();
  await page.getByLabel('관리자 비밀번호').fill(password);
  await page.getByRole('button',{name:'대시보드 열기'}).click();
  await page.getByRole('heading',{name:'기간별 상세'}).waitFor();
  for(const [name,period] of [['일간','day'],['주간','week'],['월간','month']]) {
   await page.getByRole('button',{name,exact:true}).click();
   await page.getByRole('heading',{name:'기간별 상세'}).waitFor();
   const data=await context.request.get(baseURL+'/api/usage/stats?period='+period+'&days=30');
   assert.equal(data.status(),200);
   const json=await data.json();
   assert.equal(json.period,period);assert.ok(json.series.every(row=>typeof row.date==='string'));
   assert.equal(json.series.reduce((s,row)=>s+row.analyses,0),json.totals.analyses);
  }
  for(const theme of ['light','dark','contrast']) {
   await page.evaluate(theme=>{localStorage.setItem('ralphton-theme',theme);},theme);
   await page.reload();await page.getByRole('heading',{name:'기간별 상세'}).waitFor();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   assert.equal(overflow,false,`overflow ${width}/${theme}`);
   await page.mouse.move(380,880);
   const scroll = await page.locator('main').evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));assert.ok(scroll.total>scroll.height);
   await page.getByRole('heading',{name:'기간별 상세'}).scrollIntoViewIfNeeded();
   const box=await page.getByRole('heading',{name:'기간별 상세'}).boundingBox();assert.ok(box.y>=0&&box.y<900);
   await page.screenshot({path:`test-results/usage-dashboard/${width}-${theme}-detail.png`});
   await page.locator('main').evaluate(el=>el.scrollTop=0);
   await page.screenshot({path:`test-results/usage-dashboard/${width}-${theme}.png`,fullPage:false});
  }
  const [download] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV 내려받기'}).click()]);
  const csv = await readFile(await download.path(),'utf8');assert.ok(csv.includes('방문'));assert.ok(csv.includes('Asia/Seoul'));
  await page.getByRole('button',{name:'로그아웃'}).click();
  await page.getByLabel('관리자 비밀번호').waitFor();
  assert.equal((await context.request.get(baseURL+'/api/usage/stats')).status(),401);
  assert.deepEqual(errors,[]);
  results.push({width,login:true,periods:3,themes:3,overflow:false,logout:true,pageErrors:0});
  await context.close();
 }
} finally {await browser.close();}
await writeFile('test-results/usage-dashboard/verification.json',JSON.stringify({baseURL,results},null,2));
console.log(JSON.stringify({baseURL,results}));
