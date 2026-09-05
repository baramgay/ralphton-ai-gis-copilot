import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://ralphton-ai-gis-copilot.vercel.app', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const card = await page.$('[data-testid="onboard-card"]');
if (card) { const btns = await card.$$('button'); if (btns.length) await btns[btns.length-1].click().catch(()=>{}); await page.waitForTimeout(300); }

const info = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('button').forEach(b => {
    const t = (b.textContent||'').trim();
    if (t === '분석' || t === '이용' || t === '데이터') {
      const cs = getComputedStyle(b);
      const rect = b.getBoundingClientRect();
      out.push({
        text: t, transform: cs.transform, writingMode: cs.writingMode,
        textOrientation: cs.textOrientation, whiteSpace: cs.whiteSpace,
        rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},
        parentCls: b.parentElement.className.toString().slice(0,100),
        cls: b.className.toString(),
      });
    }
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
