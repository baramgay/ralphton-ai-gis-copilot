import { chromium } from 'playwright';
import fs from 'fs';

const URL = 'https://ralphton-ai-gis-copilot.vercel.app';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 393, height: 727 },
];
const THEMES = ['light', 'dark', 'contrast'];
const TABS = ['분석', '이용', '데이터'];

async function dismissOnboard(page) {
  const card = await page.$('[data-testid="onboard-card"]');
  if (!card) return false;
  const btns = await card.$$('button');
  if (btns.length) {
    await btns[btns.length - 1].click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    if (th === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }, theme);
  await page.waitForTimeout(700); // let color-transition settle
}

async function clickTab(page, label) {
  const handles = await page.$$('button, [role="tab"]');
  for (const h of handles) {
    const t = (await h.textContent().catch(() => '') || '').replace(/\s+/g, '');
    if (t === label) {
      await h.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  }
  return false;
}

// Range.getClientRects() distinct-top line count for every leaf text element
async function checkLineWraps(page) {
  return await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll('button, a, [role="button"], [role="tab"], label, span, div');
    all.forEach(el => {
      if (el.children.length > 0) return; // leaf only
      const text = (el.textContent || '').trim();
      if (!text) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (!document.body.contains(el)) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects());
        const tops = [...new Set(rects.map(r => Math.round(r.top)))];
        if (tops.length > 1) {
          // find nearest clickable ancestor for context
          let ctx = el;
          for (let i = 0; i < 4 && ctx; i++) {
            if (ctx.tagName === 'BUTTON' || ctx.getAttribute('role') === 'button' || ctx.getAttribute('role') === 'tab') break;
            ctx = ctx.parentElement;
          }
          const ctxRect = (ctx || el).getBoundingClientRect();
          out.push({
            text: text.slice(0, 40),
            tag: el.tagName,
            cls: el.className.toString().slice(0, 90),
            lines: tops.length,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            ctxTag: ctx ? ctx.tagName : null,
            ctxRect: { x: Math.round(ctxRect.x), y: Math.round(ctxRect.y), w: Math.round(ctxRect.width), h: Math.round(ctxRect.height) },
          });
        }
      } catch (e) {}
    });
    return out;
  });
}

async function checkOverflowTruncation(page) {
  return await page.evaluate(() => {
    const out = { hScroll: [], truncated: [] };
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      out.hScroll.push({ el: 'document', scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth });
    }
    document.querySelectorAll('div, section, main, aside, ul, nav').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'visible') return;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 30) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.width < window.innerWidth * 1.5) {
          out.hScroll.push({ el: el.className.toString().slice(0, 70), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
        }
      }
    });
    document.querySelectorAll('span, div, p, button, a, li, h1,h2,h3,h4,td,th').forEach(el => {
      if (el.children.length > 1) return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      const cs = getComputedStyle(el);
      const isEllipsis = cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible';
      const clampVal = cs.webkitLineClamp;
      const isClamp = clampVal && clampVal !== 'none' && clampVal !== '';
      if (!isEllipsis && !isClamp) return;
      let clipped = false;
      if (isEllipsis) clipped = el.scrollWidth > el.clientWidth + 1;
      if (isClamp) clipped = el.scrollHeight > el.clientHeight + 1;
      if (clipped) {
        const hasTitle = el.hasAttribute('title') || el.getAttribute('aria-label');
        if (!hasTitle) {
          const rect = el.getBoundingClientRect();
          out.truncated.push({ text: text.slice(0, 60), cls: el.className.toString().slice(0, 80), tag: el.tagName, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } });
        }
      }
    });
    return out;
  });
}

async function checkTouchTargets(page, minH = 44) {
  return await page.evaluate((minH) => {
    const out = [];
    document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], select, [onclick]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return; // offscreen, skip
      if (rect.height < minH) {
        out.push({
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 30),
          cls: el.className.toString().slice(0, 80),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      }
    });
    return out;
  }, minH);
}

async function checkOcclusion(page) {
  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, a[href], [role="button"], [role="tab"]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) return;
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        out.push({
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 30),
          cls: el.className.toString().slice(0, 60),
          hitTag: hit.tagName,
          hitCls: hit.className.toString().slice(0, 60),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      }
    });
    return out;
  });
}

async function checkAccessibleNames(page) {
  return await page.evaluate(() => {
    const out = { noName: [], dupNames: {} };
    const nameMap = {};
    document.querySelectorAll('button, a[href], [role="button"], [role="tab"]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const text = (el.textContent || '').trim();
      const aria = el.getAttribute('aria-label');
      const name = (aria || text || '').trim();
      if (!name) {
        out.noName.push({ tag: el.tagName, cls: el.className.toString().slice(0, 80), rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
      } else {
        if (!nameMap[name]) nameMap[name] = [];
        nameMap[name].push({ tag: el.tagName, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } });
      }
    });
    Object.keys(nameMap).forEach(name => {
      if (nameMap[name].length > 1) out.dupNames[name] = nameMap[name];
    });
    return out;
  });
}

async function checkAriaStateMismatch(page) {
  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[aria-pressed], [aria-selected]').forEach(el => {
      const attr = el.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-selected';
      const val = el.getAttribute(attr);
      const cls = el.className.toString();
      const looksActive = /\bactive\b|\bselected\b|is-active|bg-slate-900|bg-primary/.test(cls) && !/text-slate-400|text-muted/.test(cls);
      out.push({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 20), attr, val, cls: cls.slice(0, 90) });
    });
    return out;
  });
}

async function run() {
  const browser = await chromium.launch();
  const results = {};

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await dismissOnboard(page);

    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const tab of TABS) {
        await clickTab(page, tab);
        await page.waitForTimeout(500);
        const key = `${vp.name}_${theme}_${tab}`;
        try {
          const [overflow, wraps, touch, occlusion, names, ariaState] = await Promise.all([
            checkOverflowTruncation(page),
            checkLineWraps(page),
            vp.name === 'mobile' ? checkTouchTargets(page, 44) : checkTouchTargets(page, 44),
            checkOcclusion(page),
            checkAccessibleNames(page),
            checkAriaStateMismatch(page),
          ]);
          results[key] = { overflow, wraps, touch, occlusion, names, ariaState };
          console.log(key, 'done', 'wraps=', wraps.length, 'touch<44=', touch.length, 'occl=', occlusion.length, 'trunc=', overflow.truncated.length, 'hscroll=', overflow.hScroll.length, 'noName=', names.noName.length, 'dup=', Object.keys(names.dupNames).length);
        } catch (e) {
          results[key] = { error: String(e) };
          console.log(key, 'ERROR', String(e).slice(0, 200));
        }
      }
    }
    await page.close();
  }

  fs.writeFileSync('scripts/_audit_uiux_deploy_out.json', JSON.stringify(results, null, 2));
  await browser.close();
  console.log('WROTE scripts/_audit_uiux_deploy_out.json');
}

run().catch(e => { console.error(e); process.exit(1); });
