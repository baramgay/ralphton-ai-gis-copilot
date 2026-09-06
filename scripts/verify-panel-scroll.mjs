/*
 * 패널이 스크롤되는지, 그리고 **그것을 알아볼 수 있는지**를 함께 본다.
 *
 * 둘은 다른 문제다. 스크롤은 되는데 손잡이가 안 보이면 사용자는 안 되는 줄 안다 —
 * 실제로 「휠이 없어서 스크롤이 안 되는 것 같다」는 말을 들었고, 재 보니 휠은 움직이고
 * 있었다. 손잡이 색이 패널 바탕과 1.4:1(라이트) · 2.4:1(다크)이었을 뿐이다.
 *
 * 그래서 세 가지를 묻는다.
 *   1. 넘치는 내용이 있는가 (scrollHeight > clientHeight)
 *   2. 휠이 실제로 움직이는가
 *   3. 손잡이가 바탕과 3:1 이상인가 — 글자가 아닌 UI 요소의 하한
 *
 * 실행: node scripts/verify-panel-scroll.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

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
const rgbOf = (css) => {
  const n = css.match(/[\d.]+/g)?.map(Number);
  return n && n.length >= 3 ? n.slice(0, 3) : null;
};

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
await page.waitForTimeout(1200);

/*
 * 왼쪽 패널은 기본으로 접혀 있다. 접힌 채 재면 폭 0이라 이 검사가
 * 「접혀 있어 건너뜀」으로 초록이 된다. 지시서대로 연 뒤에 잰다.
 */
await page.keyboard.press("[");
await page.waitForTimeout(400);

for (const [name, theme] of [
  ["라이트", null],
  ["다크", "dark"],
  ["고대비", "contrast"],
]) {
  await page.evaluate((value) => {
    if (value) document.documentElement.setAttribute("data-theme", value);
    else document.documentElement.removeAttribute("data-theme");
  }, theme);
  await page.waitForTimeout(600);

  console.log(`\n── ${name} 테마`);
  const seen = await page.evaluate(() => {
    const out = [];
    for (const [label, sel] of [
      ["왼쪽 패널", ".copilot-panel-left .copilot-scroll"],
      ["오른쪽 패널", ".copilot-panel-right .copilot-scroll"],
    ]) {
      const el = document.querySelector(sel);
      if (!el) {
        out.push({ label, missing: true });
        continue;
      }
      /*
       * 접힌 패널은 폭이 0이다. 그것을 결함으로 세면 「접을 수 있다」는 기능이 붉은불이
       * 된다 — 왼쪽 패널은 넓은 화면에서 접힌 채로 시작한다.
       */
      if ((el.closest(".copilot-panel")?.getBoundingClientRect().width ?? 0) < 40) {
        out.push({ label, collapsed: true });
        continue;
      }
      const cs = getComputedStyle(el);
      const panel = el.closest(".copilot-panel");
      out.push({
        label,
        overflows: el.scrollHeight > el.clientHeight + 1,
        clientH: el.clientHeight,
        // scrollbar-color 는 "손잡이 트랙" 두 값이다. 앞의 것이 손잡이.
        thumb: cs.scrollbarColor.split(") ").length > 1
          ? cs.scrollbarColor.slice(0, cs.scrollbarColor.indexOf(") ") + 1)
          : cs.scrollbarColor.split(" ")[0],
        panelBg: getComputedStyle(panel).backgroundColor,
      });
    }
    return out;
  });

  for (const row of seen) {
    if (row.missing) {
      check(false, `${row.label}: 스크롤 영역을 찾지 못함`);
      continue;
    }
    if (row.collapsed) {
      console.log(`  --  ${row.label}: 접혀 있어 건너뜀`);
      continue;
    }
    check(row.overflows, `${row.label}: 넘치는 내용이 있다`, `보이는 높이 ${row.clientH}px`);
    const thumb = rgbOf(row.thumb);
    const bg = rgbOf(row.panelBg);
    if (thumb && bg) {
      const ratio = contrast(thumb, bg);
      check(ratio >= 3, `${row.label}: 손잡이가 바탕과 구분된다`, `${ratio.toFixed(2)}:1`);
    } else {
      check(false, `${row.label}: 손잡이 색을 읽지 못함`, row.thumb);
    }
  }
}

/* 휠이 실제로 움직이는가 — 색이 보여도 안 움직이면 소용없다. */
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
for (const [label, sel] of [
  ["왼쪽 패널", ".copilot-panel-left .copilot-scroll"],
  ["오른쪽 패널", ".copilot-panel-right .copilot-scroll"],
]) {
  const target = page.locator(sel);
  if (!(await target.count())) continue;
  const panelWidth = await target.evaluate(
    (el) => el.closest(".copilot-panel")?.getBoundingClientRect().width ?? 0,
  );
  if (panelWidth < 40) {
    console.log(`  --  ${label}: 접혀 있어 건너뜀`);
    continue;
  }
  await target.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  const moved = await target.evaluate((el) => el.scrollTop);
  check(moved > 0, `${label}: 휠이 움직인다`, `scrollTop ${moved}`);
}

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
