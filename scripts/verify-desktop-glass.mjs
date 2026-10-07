import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const base=process.env.UX_VERIFY_URL??'https://gnbc.site';
const browser=await chromium.launch();
await mkdir('test-results/desktop-glass',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.route('**/api/usage/events',route=>route.fulfill({status:200,body:'{"ok":true}'}));
 await page.addInitScript(()=>{localStorage.setItem('ralphton-onboard-v1','1');localStorage.setItem('ralphton-theme','light');});
 await page.goto(base);
 await page.getByTestId('copilot-shell').waitFor({timeout:60000});
 const health=await page.evaluate(async()=>(await(await fetch('/api/health',{cache:'no-store'})).json()).build.commitSha);
 if(process.env.EXPECTED_SHA)assert.equal(health,process.env.EXPECTED_SHA);
 const toggle=page.getByRole('button',{name:'분석 설정',exact:true});
 if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-map-engine="kakao"] svg path').length>0);
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-map-engine="kakao"] img')].filter(img=>img.width>=128).every(img=>img.complete&&img.naturalWidth>=128));
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('.copilot-panel-left').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
 const panel=page.locator('.copilot-panel-left'),map=page.locator('.copilot-map');
 const bounds=await map.boundingBox();assert.equal(bounds.x,0);assert.equal(Math.round(bounds.width),1440);
 await page.screenshot({path:'test-results/desktop-glass/1440-map-behind-panels.png'});
 const visible=await panel.screenshot();
 await map.evaluate(el=>{el.style.visibility='hidden';});
 const hidden=await panel.screenshot();
 await map.evaluate(el=>{el.style.removeProperty('visibility');});
 const first=await sharp(visible).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const second=await sharp(hidden).removeAlpha().raw().toBuffer();
 let changed=0;for(let offset=0;offset<first.data.length;offset+=3)if(Math.max(...[0,1,2].map(channel=>Math.abs(first.data[offset+channel]-second[offset+channel])))>6)changed++;
 const changedRatio=changed/(first.info.width*first.info.height);
 assert(changedRatio>.1,JSON.stringify({changedRatio}));
 await page.getByLabel('분석 질의').fill('양산시 유입인구 많은 읍면동');
 await page.getByRole('button',{name:'질의 실행',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-map-engine="kakao"] svg path').length===13);
 await page.getByTestId('query-notice').filter({hasText:'분석 완료'}).waitFor();
 const left=await panel.boundingBox(),right=await page.locator('.copilot-panel-right').boundingBox();
 await page.waitForFunction(({leftEdge,rightEdge})=>[...document.querySelectorAll('[data-map-engine="kakao"] svg path')].every(path=>{const box=path.getBoundingClientRect();return box.left>=leftEdge&&box.right<=rightEdge;}),{leftEdge:left.x+left.width,rightEdge:right.x});
 const controls=[];
 for(const selector of ['.panel-edge-toggle-left','.panel-edge-toggle-right','.map-legend']) {
  const box=await page.locator(selector).boundingBox();assert(box.x>=left.x+left.width&&box.x+box.width<=right.x,JSON.stringify({selector,box,left,right}));controls.push({selector,...box});
 }
 const logo=page.locator('[data-map-engine="kakao"] a[href="http://map.kakao.com/"]');
 const logoBounds=await logo.boundingBox();assert(logoBounds.x>=left.x+left.width&&logoBounds.x+logoBounds.width<=right.x);
 await page.screenshot({path:'test-results/desktop-glass/1440-yangsan-visible.png'});
 console.log(JSON.stringify({base,health,mapWidth:bounds.width,panelBackgroundChangedRatio:changedRatio,scopedPolygons:13,controls,logo:logoBounds,failures:0}));
}finally{await browser.close();}
