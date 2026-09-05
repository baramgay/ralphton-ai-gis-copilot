import { chromium } from 'playwright';

const url = 'https://ralphton-ai-gis-copilot.vercel.app';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  // dump top-level structure
  const html = await page.evaluate(() => document.body.innerHTML.length);
  console.log('body html length', html);

  // screenshot
  await page.screenshot({ path: 'scripts/_audit_shot_desktop.png', fullPage: false });

  // check for guide/onboarding card
  const guideText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && e.textContent && e.textContent.trim().length > 0);
    return null;
  });

  // list buttons
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent.trim().slice(0,40),
    aria: e.getAttribute('aria-label'),
    cls: e.className.slice(0,60)
  })));
  console.log('BUTTONS', JSON.stringify(buttons, null, 1).slice(0, 6000));

  await browser.close();
})();
