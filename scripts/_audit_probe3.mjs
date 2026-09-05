import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://ralphton-ai-gis-copilot.vercel.app', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Check state BEFORE dismissing onboarding
const before = await page.evaluate(() => {
  const aside = document.querySelector('.copilot-panel-left');
  return aside ? { cls: aside.className, w: aside.getBoundingClientRect().width } : null;
});
console.log('before dismiss:', JSON.stringify(before));

const card = await page.$('[data-testid="onboard-card"]');
console.log('onboard card present:', !!card);
if (card) {
  const btns = await card.$$('button');
  const texts = [];
  for (const b of btns) texts.push((await b.textContent()||'').trim());
  console.log('onboard buttons:', JSON.stringify(texts));
  if (btns.length) await btns[btns.length-1].click().catch(()=>{});
  await page.waitForTimeout(300);
}

const after = await page.evaluate(() => {
  const aside = document.querySelector('.copilot-panel-left');
  return aside ? { cls: aside.className, w: aside.getBoundingClientRect().width } : null;
});
console.log('after dismiss:', JSON.stringify(after));

// look for toggle buttons near nav / aside
const toggles = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, [role="button"]').forEach(b => {
    const aria = b.getAttribute('aria-label') || '';
    const title = b.getAttribute('title') || '';
    const cls = b.className.toString();
    if (/toggle|collapse|expand|panel|menu|hamburger|sidebar/i.test(aria+title+cls)) {
      const r = b.getBoundingClientRect();
      out.push({ aria, title, cls: cls.slice(0,80), text:(b.textContent||'').trim().slice(0,20), rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} });
    }
  });
  return out;
});
console.log('toggle candidates:', JSON.stringify(toggles, null, 1));
await browser.close();
