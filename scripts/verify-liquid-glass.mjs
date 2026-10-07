import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.UX_VERIFY_URL??'http://127.0.0.1:3123';
const reportPath=`logs/liquid-glass-geometry-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
const browser=await chromium.launch();const reports=[];
await mkdir('test-results/liquid-glass',{recursive:true});
try {
 for(const width of [320,390,768,1280,1440]) for(const theme of ['light','dark','contrast']) {
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/api/usage/events',route=>route.fulfill({status:200,body:'{"ok":true}'}));
  await context.addInitScript(theme=>{localStorage.setItem('ralphton-onboard-v1','1');localStorage.setItem('ralphton-theme',theme);},theme);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByTestId('copilot-shell').waitFor({timeout:60000});
  await page.getByRole('note',{name:'분석 대상 지역: 경상남도'}).waitFor();
  const topbar=await page.locator('.copilot-topbar').evaluate(el=>Array.from(el.querySelectorAll('button,.brand-region')).map(n=>{const b=n.getBoundingClientRect();return {text:n.textContent,left:b.left,right:b.right,height:b.height};}));
  assert(topbar.every(b=>b.left>=0&&b.right<=width),JSON.stringify({width,theme,topbar}));
  assert(topbar.filter(b=>b.text!=='경상남도').every(b=>b.height>=44));
  const toggle=page.getByRole('button',{name:'분석 설정',exact:true});if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
  await page.locator('.copilot-panel-left').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  const left=await page.locator('.copilot-panel-left').boundingBox();
  if(width>=1200){assert.equal(Math.round(left.width),336);assert.equal(Math.round((await page.locator('.copilot-panel-right').boundingBox()).width),392);}
  const font=await page.locator('.dataset-selected-description').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert(font>=15);
  const change=page.getByRole('button',{name:'자료 변경',exact:true});const changeBounds=await change.boundingBox();const changeCss=await change.evaluate(el=>{const css=getComputedStyle(el);return {height:css.height,minHeight:css.minHeight,transform:css.transform,panelTransform:getComputedStyle(el.closest('.copilot-panel')).transform};});assert(changeBounds.height>=44,JSON.stringify({width,theme,changeBounds,changeCss}));
  await page.emulateMedia({reducedMotion:'reduce'});await change.hover();assert.equal(await change.evaluate(el=>getComputedStyle(el).transform),'none');
  await change.click();const dialog=page.getByRole('dialog',{name:'자료 선택',exact:true});await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);assert(bounds.y>=0&&bounds.y+bounds.height<=900);
  if(theme==='contrast')assert.equal(await dialog.evaluate(el=>getComputedStyle(el,'::backdrop').backdropFilter),'none');
  await page.screenshot({path:`test-results/liquid-glass/${width}-${theme}-catalog.png`});await page.keyboard.press('Escape');
  await page.screenshot({path:`test-results/liquid-glass/${width}-${theme}-conditions.png`});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  await page.locator('.copilot-shell').evaluate(el=>el.classList.add('is-map-moving'));
  await page.waitForFunction(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches&&getComputedStyle(document.querySelector('.copilot-topbar')).backdropFilter==='none');
  const reduced=await page.evaluate(()=>{const el=document.querySelector('.copilot-topbar');return {blur:getComputedStyle(el).backdropFilter,bg:getComputedStyle(el).backgroundColor,surface:getComputedStyle(el).getPropertyValue('--surface-1').trim(),tint:getComputedStyle(el).getPropertyValue('--glass-bg-strong').trim(),lens:getComputedStyle(document.querySelector('.map-chip-topleft'),'::before').display};});
  assert.equal(reduced.blur,'none',JSON.stringify({width,theme,reduced}));
  assert.equal(reduced.lens,'none');
  assert.equal(reduced.tint,reduced.surface);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(errors.length,0);
  reports.push({width,theme,font,topbar,reduced,errors});await context.close();
 }
 await writeFile(reportPath,JSON.stringify({base,reports},null,2));console.log(JSON.stringify({base,cases:reports.length,failures:0,reportPath}));
}finally{await browser.close();}
