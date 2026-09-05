import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://ralphton-ai-gis-copilot.vercel.app', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const card = await page.$('[data-testid="onboard-card"]');
if (card) { const btns = await card.$$('button'); if (btns.length) await btns[btns.length-1].click().catch(()=>{}); await page.waitForTimeout(300); }
await page.screenshot({ path: 'scripts/_audit_probe_full.png', fullPage: false });

const grid = await page.evaluate(() => {
  const el = document.querySelector('.grid.grid-cols-3.rounded-xl.bg-slate-100');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { rect: {x:r.x,y:r.y,w:r.width,h:r.height}, display: cs.display, gridTemplateColumns: cs.gridTemplateColumns, overflow: cs.overflow, parentChain: (()=>{
    let p = el.parentElement, chain=[];
    for(let i=0;i<6 && p;i++){ const pr=p.getBoundingClientRect(); const pcs=getComputedStyle(p); chain.push({tag:p.tagName,cls:p.className.toString().slice(0,80),w:pr.width,h:pr.height,overflow:pcs.overflow,display:pcs.display}); p=p.parentElement;}
    return chain;
  })() };
});
console.log(JSON.stringify(grid, null, 1));
await browser.close();
