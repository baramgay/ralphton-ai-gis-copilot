/*
 * 화면 **전체**의 글자가 네 테마 모두에서 읽히는가.
 *
 * 이미 `verify-readable.mjs` 가 있지만 그것은 안내 문서 세 자리만 본다. 이 검사는
 * 화면에 실제로 보이는 **모든** 글자를 센다 — 탭 셋, 테마 셋, 화면 폭 둘.
 *
 * 왜 다시 재나: 테마 전환이 Tailwind 색 유틸리티를 **하나씩 열거해** 덮는 방식이라,
 * 열거에 없는 클래스는 조용히 라이트 색으로 남는다. 소스가 쓰는 글자색 유틸 35개 중
 * 열거된 것은 22개였다(실측). 빌드·lint·tsc 는 이 차이를 못 본다 — 화면에서만 보인다.
 *
 * 판정은 「무슨 클래스를 썼나」가 아니라 **렌더된 색 대 실제로 칠해진 바탕**이다.
 * 바탕이 투명하면 부모로 거슬러 올라가고, 유리(반투명)면 그 아래 색과 합성한다 —
 * 반투명 위에서는 유틸리티 이름만 봐서는 무슨 색 위에 있는지 알 수 없다.
 *
 * 색은 정규식으로 읽지 않고 **캔버스에 한 픽셀 찍어서** 읽는다. Tailwind v4 를 쓰면
 * `getComputedStyle` 이 `lab()`·`oklab()` 로도 돌려주는데(배포본에서 950개 중 37개,
 * 실측), 숫자만 뽑아 RGB 로 읽으면 엉뚱한 값이 나와 **미달을 통과로 셌다**. 캔버스는
 * 브라우저가 실제로 칠할 색을 그대로 준다 — 표기법이 무엇이든.
 *
 * 실행: node scripts/verify-contrast-all.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
const TABS = [
  ["분석", "control"],
  ["이용", "help"],
  ["데이터", "data"],
];
const THEMES = [
  ["라이트", null],
  ["다크", "dark"],
  ["고대비", "contrast"],
];
const VIEWPORTS = [
  ["데스크톱", { width: 1440, height: 900 }],
  ["모바일", { width: 390, height: 844 }],
];

/* 페이지 안에서 도는 채점기. 바탕은 합성해서 찾는다. */
const SCORE = `(() => {
  /* 어떤 CSS 색 표기든 브라우저가 칠하는 RGBA 로 바꾼다. */
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.globalCompositeOperation = "copy";
  const parse = (value) => {
    if (!value) return [];
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  /* 반투명 층을 아래에서 위로 합성해 실제 칠해진 색을 만든다. */
  const painted = (node) => {
    const stack = [];
    for (let cur = node; cur; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      /* 바탕이 그림이면 색으로 잴 수 없다 — 지도 군집 배지는 PNG 스프라이트다.
         모르는 것을 통과로도 미달로도 세지 않고 따로 센다. */
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const p = parse(cs.backgroundColor);
      if (!p.length) continue;
      const a = p[3];
      if (a <= 0.001) continue;
      stack.push([p.slice(0, 3), a]);
      if (a >= 0.999) break;
    }
    /*
     * 맨 아래 색은 흰색이 아니라 **문서가 실제로 칠한 바탕**이다. 흰색으로 두면
     * 다크 테마에서 반투명 층을 흰 바탕 위에 합성해 회색이 나오고, 멀쩡한 글자가
     * 미달로 잡힌다(실측 rgb(130,134,149) — 화면 어디에도 없는 색이었다).
     */
    let base = [255, 255, 255];
    for (const root of [document.body, document.documentElement]) {
      const p = parse(getComputedStyle(root).backgroundColor);
      if (p.length && p[3] >= 0.999) { base = p.slice(0, 3); break; }
    }
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i][0], base, stack[i][1]);
    return base;
  };
  const seen = [];
  let unmeasurable = 0;
  let disabled = 0;
  for (const node of document.querySelectorAll("body *")) {
    if (node.children.length) continue;
    const text = (node.textContent || "").trim();
    if (!text) continue;
    const cs = getComputedStyle(node);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (node.closest("[aria-hidden='true']")) continue;
    /* 비활성 컨트롤은 WCAG 1.4.3 예외다. 세지 않되 몇 개인지는 밝힌다. */
    if (node.closest("button:disabled, input:disabled, select:disabled, [aria-disabled='true']")) {
      disabled += 1;
      continue;
    }
    const fgp = parse(cs.color);
    if (!fgp.length) continue;
    const alpha = fgp[3];
    if (alpha < 0.15) continue;
    const bg = painted(node);
    if (!bg) { unmeasurable += 1; continue; }
    const fg = alpha >= 0.999 ? fgp.slice(0, 3) : over(fgp.slice(0, 3), bg, alpha);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight);
    /* WCAG 「큰 글자」 = 18.66px 이상, 또는 14px 이상이면서 굵기 700 이상. */
    const need = size >= 18.66 || (size >= 14 && weight >= 700) ? 3 : 4.5;
    seen.push({ value: ratio(fg, bg), need, text: text.slice(0, 26), cls: String(node.className || ""), tag: node.tagName, size, weight, fg: fg.map(Math.round).join(","), bg: bg.map(Math.round).join(",") });
  }
  return { seen, unmeasurable, disabled };
})()`;

const failures = [];
let counted = 0;
let skipped = 0;
let offDuty = 0;
const browser = await chromium.launch();

for (const [vpName, viewport] of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
  try {
    await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
    await page.getByTestId("onboard-card").waitFor({ state: "detached", timeout: 5_000 });
  } catch {
    // 안내를 이미 본 프로필이면 카드가 없다.
  }
  /* 좁은 화면에서는 패널이 접혀 있다. 접힌 채로 재면 아무것도 안 센다. */
  const opener = page.getByTestId("panel-edge-toggle");
  if ((await opener.count()) && (await opener.isVisible())) await opener.click().catch(() => {});

  for (const [themeName, theme] of THEMES) {
    await page.evaluate((value) => {
      if (value) document.documentElement.setAttribute("data-theme", value);
      else document.documentElement.removeAttribute("data-theme");
    }, theme);

    for (const [tabLabel] of TABS) {
      const tab = page.getByRole("tab", { name: tabLabel });
      if (await tab.count()) await tab.first().click().catch(() => {});
      /* 색 전이(140ms)가 끝난 뒤에 읽는다. 그전에 재면 전이 도중의 색이 나온다. */
      await page.waitForTimeout(700);
      /* 접힌 것 안의 글자는 안 보이는 게 아니라 아직 안 그려진 것이다. 펼쳐서 잰다. */
      const summaries = page.locator("details:not([open]) > summary");
      for (let i = 0; i < (await summaries.count()); i++)
        await summaries.nth(i).click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);

      const { seen: rows, unmeasurable, disabled } = await page.evaluate(SCORE);
      offDuty += disabled;
      counted += rows.length;
      skipped += unmeasurable;
      const bad = rows.filter((row) => row.value < row.need - 0.005);
      for (const row of bad)
        failures.push(
          `${vpName}/${themeName}/${tabLabel} · 「${row.text}」 ${row.value.toFixed(2)}:1 ` +
            `(필요 ${row.need}) · 글자 rgb(${row.fg}) 바탕 rgb(${row.bg}) · ${row.tag}.${row.cls || "(클래스 없음)"} ${row.size}px/${row.weight}`,
        );
      console.log(
        `  ${bad.length === 0 ? "OK " : "!! "} ${vpName}/${themeName}/${tabLabel}: ` +
          `${rows.length}개 중 ${bad.length}개 미달` +
          (unmeasurable ? ` (바탕이 그림이라 못 잰 것 ${unmeasurable}개)` : ""),
      );
    }
  }
  await context.close();
}

await browser.close();
console.log(`\n잰 글자 ${counted}개`);
if (failures.length === 0) console.log("전부 통과");
else {
  console.log(`미달 ${failures.length}건:`);
  /* 같은 문구가 탭마다 되풀이되므로 클래스별로 묶어서 보여 준다 — 고칠 자리는 클래스다. */
  const byClass = new Map();
  for (const line of failures) {
    const key = line.split(" · ")[2] ?? line;
    (byClass.get(key) ?? byClass.set(key, []).get(key)).push(line);
  }
  for (const [key, lines] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n[${lines.length}건] ${key}`);
    for (const line of lines.slice(0, 3)) console.log(`   ${line}`);
  }
}
process.exit(failures.length === 0 ? 0 : 1);
