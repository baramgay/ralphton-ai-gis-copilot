import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.UX_VERIFY_URL ?? 'http://127.0.0.1:3110';
await mkdir('test-results/intuitive-workspace', { recursive: true });
const browser = await chromium.launch();
const reports=[];
try {
 for (const width of [390,768,1280,1440]) {
  for (const theme of ['light','dark','contrast']) {
   const context=await browser.newContext({viewport:{width,height:900}});
   // Automated UI checks must not inflate the anonymous production dashboard.
   await context.route('**/api/usage/events', route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
   await context.addInitScript(({theme})=>{localStorage.setItem('ralphton-onboard-v1','1');localStorage.setItem('ralphton-theme',theme);}, {theme});
   const page=await context.newPage(); const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base); await page.getByTestId('copilot-shell').waitFor({timeout:60000});
   await page.screenshot({path:`test-results/intuitive-workspace/${width}-${theme}-workspace.png`});
   const toggle=page.getByRole('button',{name:'분석 설정',exact:true});
   if(await toggle.getAttribute('aria-pressed')!=='true') await toggle.click();
   await page.getByRole('button',{name:'자료 변경'}).click();
   const dialog=page.getByRole('dialog',{name:'자료 선택'}); await dialog.waitFor();
   await page.screenshot({path:`test-results/intuitive-workspace/${width}-${theme}-catalog.png`});
   const bounds=await dialog.boundingBox();
   await page.getByRole('searchbox',{name:'자료 검색'}).fill('유출');
   const results=await dialog.locator('[data-layer-id]').count();
   await page.getByRole('button',{name:/^이동인구/}).click();
   await page.getByTestId('metric-picker').getByRole('button',{name:/유출인구/}).click();
   await page.screenshot({path:`test-results/intuitive-workspace/${width}-${theme}-conditions.png`});
   const report={width,theme,errors,results,dialogFits:bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900,
     horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),
     selection:await page.getByTestId('dataset-selected').innerText(),
     metricSelected:await page.getByTestId('metric-picker').getByRole('button',{name:/유출인구/}).getAttribute('aria-pressed')};
   if(errors.length||results!==1||!report.dialogFits||report.horizontalOverflow||report.metricSelected!=='true') throw new Error(JSON.stringify(report));
   reports.push(report); await context.close();
  }
 }
 await writeFile('logs/intuitive-workspace-visual.json',JSON.stringify(reports,null,2));
 console.log(JSON.stringify({base,cases:reports.length,failures:0}));
} finally {await browser.close();}
