import { chromium } from 'playwright';
import fs from 'fs';

const url = 'https://ralphton-ai-gis-copilot.vercel.app';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 393, height: 727 },
];
const THEMES = ['light', 'dark', 'contrast'];

async function dismissOnboarding(page) {
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = (await b.textContent().catch(() => '') || '').trim();
    if (t === '바로 시작') {
      try { await b.click({ timeout: 2000 }); } catch {}
      break;
    }
  }
  await page.waitForTimeout(400);
}

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    if (th === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }, theme);
  await page.waitForTimeout(700);
}

async function clickTabByText(page, text) {
  const els = await page.$$('button');
  for (const el of els) {
    const t = (await el.textContent().catch(() => '') || '').trim();
    if (t === text) {
      const box = await el.boundingBox();
      if (box) { await el.click({ timeout: 2000 }).catch(() => {}); return true; }
    }
  }
  return false;
}

async function checkOverflowAndTruncation(page) {
  return await page.evaluate(() => {
    const results = { hScroll: [], truncated: [] };
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      results.hScroll.push({ el: 'document', scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth });
    }
    const all = document.querySelectorAll('div, section, main, aside');
    all.forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'visible') return;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50) {
          results.hScroll.push({ el: el.className.toString().slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: cs.overflowX });
        }
      }
    });
    const textEls = document.querySelectorAll('span, div, p, button, a, li, h1,h2,h3,h4');
    textEls.forEach(el => {
      if (el.children.length > 1) return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      const cs = getComputedStyle(el);
      const isEllipsis = cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible';
      const isClamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (!isEllipsis && !isClamp) return;
      let clipped = false;
      if (isEllipsis) {
        clipped = el.scrollWidth > el.clientWidth + 1;
      }
      if (isClamp) {
        clipped = el.scrollHeight > el.clientHeight + 1;
      }
      if (clipped) {
        const hasTitle = el.hasAttribute('title') || el.getAttribute('aria-label');
        if (!hasTitle) {
          const rect = el.getBoundingClientRect();
          results.truncated.push({
            text: text.slice(0, 60),
            cls: el.className.toString().slice(0, 80),
            tag: el.tagName,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          });
        }
      }
    });
    return results;
  });
}

async function checkButtonLineWrap(page) {
  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button').forEach(btn => {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const style = getComputedStyle(btn);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      const range = document.createRange();
      range.selectNodeContents(btn);
      const rects = Array.from(range.getClientRects());
      if (rects.length === 0) return;
      const tops = new Set(rects.map(r => Math.round(r.top)));
      if (tops.size > 1) {
        out.push({
          text: (btn.textContent || '').trim().slice(0, 50),
          cls: btn.className.toString().slice(0, 80),
          lines: tops.size,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      }
    });
    return out;
  });
}

async function checkTouchTargets(page, minSize = 44) {
  return await page.evaluate((minSize) => {
    const sels = 'button, a[href], input, select, [role="button"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
    const out = [];
    document.querySelectorAll(sels).forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
      if (rect.height < minSize || rect.width < minSize) {
        out.push({
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
          tag: el.tagName,
          cls: el.className.toString().slice(0, 70),
          w: Math.round(rect.width), h: Math.round(rect.height),
          x: Math.round(rect.x), y: Math.round(rect.y)
        });
      }
    });
    return out;
  }, minSize);
}

async function checkOcclusion(page, selectors) {
  return await page.evaluate((selectors) => {
    const out = [];
    selectors.forEach(({ name, selector }) => {
      const els = document.querySelectorAll(selector);
      els.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return;
        const top = document.elementFromPoint(cx, cy);
        const contains = top && (el === top || el.contains(top) || top.contains(el));
        if (!contains) {
          out.push({
            name, idx,
            expectedCls: el.className.toString().slice(0, 60),
            actualEl: top ? (top.tagName + '.' + top.className.toString().slice(0, 60)) : 'null',
            point: { x: Math.round(cx), y: Math.round(cy) }
          });
        }
      });
    });
    return out;
  }, selectors);
}

async function main() {
  const browser = await chromium.launch();
  const allResults = {};

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const key = `${vp.name}_${theme}`;
      console.log('=== ', key);
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      await dismissOnboarding(page);
      await setTheme(page, theme);

      const res = { tabs: {} };

      for (const tabName of ['분석', '이용', '데이터']) {
        if (tabName !== '분석') {
          await clickTabByText(page, tabName);
          await page.waitForTimeout(600);
        }
        const overflow = await checkOverflowAndTruncation(page);
        const wraps = await checkButtonLineWrap(page);
        const touch = vp.name === 'mobile' ? await checkTouchTargets(page) : [];
        res.tabs[tabName] = { overflow, wraps, touch };
        await page.screenshot({ path: `scripts/_audit_shot_${key}_${tabName}.png` }).catch(() => {});
      }
      await clickTabByText(page, '분석');
      await page.waitForTimeout(500);

      const occlusion = await checkOcclusion(page, [
        { name: 'quick-tile', selector: '.quick-tile' },
        { name: 'layer-switcher-item', selector: '.layer-switcher-item' },
        { name: 'sheet-snap-btn', selector: '.sheet-snap-btn' },
        { name: 'copilot-topbar-link', selector: '.copilot-topbar-link' },
      ]);
      res.occlusion = occlusion;

      allResults[key] = res;
      await page.close();
    }
  }

  fs.writeFileSync('scripts/_audit_results.json', JSON.stringify(allResults, null, 1));
  await browser.close();
  console.log('DONE');
}

main();
