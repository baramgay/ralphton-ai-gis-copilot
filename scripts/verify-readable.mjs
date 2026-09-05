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

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
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
      /* 실제로 칠해진 바탕을 찾는다 — 투명하면 부모로 올라간다. */
      const paintedBg = (node) => {
        let cur = node;
        while (cur) {
          const parts = getComputedStyle(cur).backgroundColor.match(/[\d.]+/g)?.map(Number);
          if (parts && (parts.length < 4 || parts[3] > 0.85)) return parts.slice(0, 3);
          cur = cur.parentElement;
        }
        return [0, 0, 0];
      };
      let found = null;
      let counted = 0;
      for (const node of el.querySelectorAll("p, li, span, summary")) {
        const text = (node.textContent || "").trim();
        if (!text || node.children.length) continue;
        counted += 1;
        const cs = getComputedStyle(node);
        const fg = cs.color.match(/[\d.]+/g).map(Number).slice(0, 3);
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
