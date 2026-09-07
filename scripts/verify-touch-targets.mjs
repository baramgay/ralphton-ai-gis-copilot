/*
 * 보이는 표적(button · a · [role=tab])의 히트 영역이 44×44 인지 배포본에서 잰다.
 *
 * getBoundingClientRect 만 보면 시각 크기만 나온다. 투명 ::before 로 히트를 넓힌
 * 자리도 잡아야 하므로, 요소 중심의 44×44 상자 모서리 네 점을 elementFromPoint 로
 * 찍는다. 그 점이 다른 요소면 히트가 겹치거나 가려진 것이다.
 *
 * 실행: node scripts/verify-touch-targets.mjs [URL]
 *       node scripts/verify-touch-targets.mjs [URL] --break  ← 검사 자신을 시험한다
 *
 * `--break` 는 min-height/min-width 를 20px 로 눌러 결함을 심는다. 이때 붉어져야
 * 이 검사가 실제로 무언가를 보고 있다는 뜻이다.
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const BREAK = process.argv.includes("--break");
const MIN = 44;
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const dismissOnboard = async (page) => {
  try {
    await page.getByTestId("onboard-card").waitFor({ timeout: 6_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
  } catch {
    // 안내를 이미 본 프로필이면 카드가 없다.
  }
};

const openLeft = async (page, narrow) => {
  if (narrow) {
    const toggle = page.getByRole("button", { name: "조작", exact: true });
    if (await toggle.isVisible().catch(() => false)) {
      const panel = page.locator(".copilot-panel-left");
      if (!(await panel.evaluate((el) => el.classList.contains("sheet-open")))) {
        await toggle.click({ force: true });
      }
    }
    return;
  }
  await page.keyboard.press("[");
  await page.waitForTimeout(400);
};

const measure = async (page) =>
  page.evaluate((min) => {
    const visible = (el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      if (el.classList.contains("skip-link")) return false;
      /*
       * 카카오가 지도 안에 심는 저작권 링크는 우리 크롬이 아니다.
       * 44로 키우면 법적 표기를 일그러뜨리고, 안 키우면 이 검사가 제품 표적으로 센다.
       */
      const href = el.getAttribute("href") || "";
      if (/map\.kakao\.com|kakao\.com\/|daumcdn\.net/.test(href)) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.pointerEvents === "none") {
        return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) {
        return false;
      }
      /*
       * 패널 접힌 자리에 걸쳐 있는 칩은 레이아웃 상자만 있다. 모서리를 찍으면
       * 패널 밖이 잡힌다 — 그건 안 보이는 표적이지 작은 표적이 아니다.
       */
      for (let p = el.parentElement; p; p = p.parentElement) {
        const overflow = getComputedStyle(p);
        if (!/(auto|scroll|hidden|clip)/.test(`${overflow.overflowX}${overflow.overflowY}`)) continue;
        const pr = p.getBoundingClientRect();
        if (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5 || r.left < pr.left - 0.5 || r.right > pr.right + 0.5) {
          return false;
        }
      }
      /*
       * overflow 로 잘린 버튼은 레이아웃 상자에만 있다. 모서리를 찍으면 그 자리의
       * 다른 요소가 잡힌다. 중심이 실제로 이 버튼이면 「보이는」 것이다.
       */
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!mid) return false;
      return el === mid || el.contains(mid) || mid.contains(el);
    };

    const labelOf = (el) =>
      (el.getAttribute("aria-label") || el.textContent || el.getAttribute("href") || el.tagName)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);

    const hits = (el, x, y) => {
      const top = document.elementFromPoint(x, y);
      if (!top) return false;
      return el === top || el.contains(top) || top.contains(el);
    };

    const nodes = [...document.querySelectorAll('button, a, [role="tab"]')].filter(visible);
    const misses = [];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      /*
       * 히트 영역은 요소 전체가 아니라 중심 44×44 다. 큰 타일의 바깥 모서리나
       * 알약 버튼의 둥근 바깥각을 찍으면 옆 요소가 잡힌다.
       * 둥근 44 원의 내접 사각형은 중심에서 ±15.5 이므로 8px 들여 찍는다.
       */
      const half = min / 2;
      const inset = 8;
      const points = [
        [cx - half + inset, cy - half + inset],
        [cx + half - inset, cy - half + inset],
        [cx - half + inset, cy + half - inset],
        [cx + half - inset, cy + half - inset],
      ];
      const sizeOk = r.width + 0.5 >= min && r.height + 0.5 >= min;
      const corners = points.filter(([x, y]) => hits(el, x, y)).length;
      if (!sizeOk || corners < 4) {
        misses.push({
          label: labelOf(el),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          corners,
        });
      }
    }
    return { total: nodes.length, misses };
  }, MIN);

const browser = await chromium.launch();
const viewports = [
  ["데스크톱", { width: 1440, height: 900 }, false],
  ["태블릿", { width: 834, height: 1194 }, true],
  ["태블릿가로", { width: 1180, height: 820 }, true],
  ["모바일", { width: 390, height: 844 }, true],
  ["폰가로", { width: 844, height: 390 }, true],
];

for (const [name, viewport, narrow] of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
  await dismissOnboard(page);
  await page.waitForTimeout(800);
  await openLeft(page, narrow);
  await page.waitForTimeout(500);

  if (BREAK) {
    await page.addStyleTag({
      content: `
        .copilot-shell button, .copilot-shell a, .copilot-shell [role="tab"],
        .copilot-topbar-link, .layer-switcher-item, .metric-chip, .query-hero-chip,
        .query-hero-submit {
          min-height: 20px !important;
          min-width: 20px !important;
          height: 20px !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
      `,
    });
    console.log(`  (--break) ${name}: 결함을 심었다 — 아래가 초록이면 이 검사는 아무것도 안 보고 있다`);
  }

  console.log(`\n── ${name} ${viewport.width}×${viewport.height}`);
  const result = await measure(page);
  check(
    result.misses.length === 0,
    `${name}: 보이는 표적 ${result.total}개 중 44×44 미달 ${result.misses.length}건`,
    result.misses.length
      ? result.misses
          .slice(0, 8)
          .map((m) => `${m.label} ${m.w}×${m.h} 모서리${m.corners}/4`)
          .join("; ")
      : "0건",
  );
  await context.close();
}

await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
