import { chromium } from 'playwright';
const url = 'https://ralphton-ai-gis-copilot.vercel.app';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  // dismiss onboarding
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = (await b.textContent() || '').trim();
    if (t === '바로 시작') { await b.click(); break; }
  }
  await page.waitForTimeout(500);

  const snap = await page.accessibility.snapshot({ interestingOnly: true });
  function flatten(node, out) {
    if (!node) return;
    if (node.role === 'button' || node.role === 'link' || node.role === 'checkbox' || node.role === 'tab' || node.role==='radio') {
      out.push({role: node.role, name: node.name, pressed: node.pressed, checked: node.checked, selected: node.selected});
    }
    (node.children||[]).forEach(c => flatten(c, out));
  }
  const out = [];
  flatten(snap, out);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
