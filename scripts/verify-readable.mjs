/*
 * 안내 문서가 **네 테마 모두에서 읽히는지** 본다.
 *
 * 활용 가이드·활용 데이터·용어집은 「무엇을 썼고 어떻게 읽는가」를 답하는 자리다.
 * 안 보이면 없는 것과 같다. 그런데 이 화면들은 Tailwind 색 유틸리티로 칠해져 있고,
 * 테마 전환은 그 유틸리티를 **하나씩 열거해** 덮는다 — 열거에서 빠진 클래스는 조용히
 * 원래 색으로 남는다. 실제로 `text-amber-700`(다크 1.29:1)과 `text-slate-400`
 * (고대비 1.24:1)이 그렇게 새어 나가 바탕에 묻혔다. 빌드도 lint 도 초록이었다.
 *
 * 그래서 화면에서 읽어 온 **실제 색**으로 잰다. 바탕은 투명한 부모를 거슬러 올라가
 * 실제로 칠해진 면을 찾는다 — 요소 자신의 background 만 보면 늘 transparent 다.
 *
 * 실행: node scripts/verify-readable.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const failures = [];

const relLum = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SECTIONS = [
  ["활용가이드", "usage-guide"],
  ["활용가이드", "glossary"],
  ["활용데이터", "data-inventory"],
];
const THEMES = [
  ["라이트", null],
  ["다크", "dark"],
  ["고대비", "contrast"],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 6_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
} catch {
  // 안내를 이미 본 프로필이면 카드가 없다.
}

for (const [themeName, theme] of THEMES) {
  console.log(`\n── ${themeName} 테마`);
  await page.evaluate((value) => {
    if (value) document.documentElement.setAttribute("data-theme", value);
    else document.documentElement.removeAttribute("data-theme");
  }, theme);

  for (const [tab, testId] of SECTIONS) {
    await page.getByRole("button", { name: tab }).click();
    /* 색 전이(140ms)가 끝난 뒤에 읽는다. 그전에 재면 전이 도중의 색이 나온다. */
    await page.waitForTimeout(700);

    const root = page.getByTestId(testId);
    if (!(await root.count())) {
      console.log(`  !!  ${testId}: 화면에 없다`);
      failures.push(`${themeName}/${testId} 없음`);
      continue;
    }
    /* 접힌 채로 재면 안 보이는 글자를 못 본다. 전부 펼친다. */
    const summaries = root.locator("summary");
    for (let i = 0; i < (await summaries.count()); i++) await summaries.nth(i).click();
    await page.waitForTimeout(400);

    const worst = await root.evaluate((el, minRatio) => {
      /*
       * 색은 **정규식으로 읽으면 안 된다.** Tailwind v4 는 `lab()`·`oklab()` 로도
       * 돌려주는데, 숫자만 뽑아 RGB 로 쓰면 `lab(98.14 -0.37 -1.06)`(거의 흰색)이
       * rgb(98, 0, 1)(어두운 붉은색)이 된다. 2026-09-08 배포본에서 멀쩡한
       * 「경남빅데이터허브플랫폼」이 1.48:1 로 잡혔다 — 실제로는 14:1 이다.
       * 브라우저에게 칠하게 하고 그 픽셀을 읽는다.
       */
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
        const f = (v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
      /*
       * 실제로 칠해진 바탕을 만든다. 반투명 층을 아래에서 위로 합성하되, 맨 아래는
       * 흰색이 아니라 **문서가 칠한 색**이다 — 흰색으로 두면 다크 테마에서 화면
       * 어디에도 없는 회색이 나온다.
       */
      const paintedBg = (node) => {
        const stack = [];
        for (let cur = node; cur; cur = cur.parentElement) {
          const p = parse(getComputedStyle(cur).backgroundColor);
          if (!p.length || p[3] <= 0.001) continue;
          stack.push([p.slice(0, 3), p[3]]);
          if (p[3] >= 0.999) break;
        }
        let base = [255, 255, 255];
        for (const root of [document.body, document.documentElement]) {
          const p = parse(getComputedStyle(root).backgroundColor);
          if (p.length && p[3] >= 0.999) {
            base = p.slice(0, 3);
            break;
          }
        }
        for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i][0], base, stack[i][1]);
        return base;
      };
      let found = null;
      let counted = 0;
      for (const node of el.querySelectorAll("p, li, span, summary")) {
        const text = (node.textContent || "").trim();
        if (!text || node.children.length) continue;
        counted += 1;
        const cs = getComputedStyle(node);
        const fgp = parse(cs.color);
        if (!fgp.length) continue;
        const fg = over(fgp.slice(0, 3), paintedBg(node), fgp[3]);
        const size = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight);
        // WCAG 의 「큰 글자」는 18.66px 이상이거나 14px 이상 굵기 700 이상이다.
        const need = size >= 18.66 || (size >= 14 && weight >= 700) ? 3 : minRatio;
        const value = ratio(fg, paintedBg(node));
        const slack = value - need;
        if (!found || slack < found.slack)
          found = { slack, value, need, text: text.slice(0, 22), cls: node.className };
      }
      return found ? { ...found, counted } : null;
    }, 4.5);

    if (!worst) {
      console.log(`  --  ${testId}: 잴 글자가 없다`);
      continue;
    }
    const ok = worst.slack >= 0;
    if (!ok) failures.push(`${themeName}/${testId} ${worst.value.toFixed(2)}:1`);
    console.log(
      `  ${ok ? "OK " : "!! "} ${testId}: 최악 ${worst.value.toFixed(2)}:1 (필요 ${worst.need}) ` +
        `— 「${worst.text}」 ${worst.cls || "(클래스 없음)"} · 잰 글자 ${worst.counted}개`,
    );
  }
}

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
