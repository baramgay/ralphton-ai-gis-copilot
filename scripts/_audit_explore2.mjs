import { chromium } from 'playwright';
const url = 'https://ralphton-ai-gis-copilot.vercel.app';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'scripts/_audit_shot_desktop2.png' });
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log(bodyText);
  await browser.close();
})();
