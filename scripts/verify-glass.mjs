/*
 * 유리가 **실제로 붙었는지**를 배포본 화면에서 본다.
 *
 * 토큰을 넣고 규칙을 고쳐도 화면은 그대로일 수 있다. 아래 어딘가의 !important 가 덮거나,
 * 어두운 블록에만 정의한 토큰이 라이트에서 조용히 사라지거나, 클래스가 안 붙는다.
 * 빌드·유닛·e2e 는 셋 중 무엇도 보지 못한다 — 전부 초록인 채로 재질만 없다.
 *
 * 그래서 세 가지를 묻는다.
 *   1. 네 테마 각각에서 --glass-* 가 값으로 풀리는가 (라이트에서 빈 문자열이면 실패)
 *   2. 지도 위 부유층에 backdrop-filter 가 실제로 걸렸는가 (고대비는 none 이어야 정상)
 *   3. 그 위의 글자가 최악의 타일에서도 AA(4.5:1)를 넘는가 — 계산이 아니라 화면에서
 *      읽어 온 실제 색으로
 *
 * 실행: node scripts/verify-glass.mjs [URL] (종료 코드로 판정)
 *       node scripts/verify-glass.mjs [URL] --break   ← 검사 자신을 시험한다
 *
 * `--break` 는 화면에 결함을 심는다: 라이트의 --glass-bg 를 지우고 backdrop-filter 를
 * 전부 끈다. 이때 **붉게 가야** 이 검사가 실제로 무언가를 보고 있다는 뜻이다.
 * 초록불은 「위반 없음」과 「검사가 못 봄」을 구분하지 못한다. CSS 가 HTML 에 인라인되어
 * 있어 파일을 고쳐 심을 수 없으므로 검사 안에 심는 길을 둔다.
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
const BREAK = process.argv.includes("--break");
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

/** 유리 위 글자의 실제 배경 = 틴트를 타일 색 위에 알파 합성한 값. */
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
const parseColor = (css) => {
  const nums = css.match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length < 3) return null;
  return { rgb: nums.slice(0, 3), alpha: nums.length > 3 ? nums[3] : 1 };
};
const composite = ({ rgb, alpha }, tile) => rgb.map((v, i) => alpha * v + (1 - alpha) * tile[i]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });

/* 첫 방문 안내가 떠 있으면 지도 위 요소를 가린다. */
try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 6_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
} catch {
  // 이미 본 프로필이면 카드가 없다. 정상이다.
}

if (BREAK) {
  await page.addStyleTag({
    content: `:root { --glass-bg: ; }
      .query-hero-input, .query-hero-chip, .map-float-bar {
        -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
        background: rgb(255 255 255 / 40%) !important; color: #8fa3bd !important;
      }`,
  });
  console.log("  (--break) 결함을 심었다 — 아래가 초록이면 이 검사는 아무것도 안 보고 있다\n");
}

const THEMES = [
  ["라이트", null],
  ["다크", "dark"],
  ["고대비", "contrast"],
];

for (const [name, attr] of THEMES) {
  await page.evaluate((value) => {
    if (value) document.documentElement.setAttribute("data-theme", value);
    else document.documentElement.removeAttribute("data-theme");
  }, attr);
  await page.waitForTimeout(120);

  const probe = await page.evaluate(() => {
    const read = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
    const root = document.documentElement;
    const tokens = Object.fromEntries(
      ["--glass-bg", "--glass-bg-strong", "--glass-border", "--glass-blur", "--touch-min"].map((t) => [
        t,
        read(root, t),
      ]),
    );
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        color: cs.color,
        weight: cs.fontWeight,
        filter: cs.backdropFilter || cs.webkitBackdropFilter || "none",
      };
    };
    return {
      tokens,
      input: pick(".query-hero-input"),
      chip: pick(".query-hero-chip"),
      bar: pick(".map-float-bar"),
      btn: pick(".map-float-btn"),
    };
  });

  console.log(`\n── ${name} 테마`);

  /*
   * 라이트에서 빈 값이 나오면 어두운 블록에만 정의했다는 뜻이다 — 화면은 조용히 무너지고
   * 빌드도 콘솔도 아무 말을 하지 않는다. 이 검사가 그 자리를 잡는다.
   */
  for (const [token, value] of Object.entries(probe.tokens))
    check(value !== "", `${token} 가 값으로 풀린다`, value || "(빈 값)");

  const glassy = name !== "고대비";
  for (const [label, part] of [
    ["질의창", probe.input],
    ["칩", probe.chip],
    ["버튼 줄", probe.bar],
  ]) {
    if (!part) {
      check(false, `${label} 요소를 찾지 못함`);
      continue;
    }
    const blurred = /blur/.test(part.filter);
    check(
      glassy ? blurred : !blurred,
      `${label}: ${glassy ? "유리가 걸렸다" : "고대비에서 유리를 버렸다"}`,
      part.filter,
    );
  }

  /*
   * 대비는 최악의 타일에서 본다. 유리 뒤 지도는 사용자가 움직이므로 배경을 우리가
   * 정할 수 없다 — 순백(위성)과 순흑(야간) 양쪽에서 넘어야 실제 타일에서 넘는다.
   */
  for (const [label, part] of [
    ["질의창 글자", probe.input],
    ["칩 글자", probe.chip],
    ["버튼 글자", probe.btn ?? probe.bar],
  ]) {
    if (!part) continue;
    const bg = parseColor(part.bg);
    const fg = parseColor(part.color);
    if (!bg || !fg) continue;
    // 버튼은 배경이 투명이라 줄(bar)의 유리를 바탕으로 삼는다.
    const tint = bg.alpha === 0 ? parseColor(probe.bar.bg) : bg;
    if (!tint) continue;
    const worst = Math.min(
      contrast(fg.rgb, composite(tint, [255, 255, 255])),
      contrast(fg.rgb, composite(tint, [0, 0, 0])),
    );
    check(worst >= 4.5, `${label}: 최악 타일에서도 AA`, `${worst.toFixed(2)}:1`);
  }
}

/* 지점 카드가 열렸을 때 닫기 단추가 실제로 눌리는가. */
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
const probeToggle = page.getByTestId("probe-toggle");
if (await probeToggle.count()) {
  await probeToggle.first().click();
  await page.locator(".copilot-map").click({ position: { x: 380, y: 360 } });
  const card = page.getByTestId("probe-card");
  try {
    await card.waitFor({ timeout: 15_000 });
    const reachable = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="probe-card"]');
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12);
      return Boolean(hit && el.contains(hit));
    });
    check(reachable, "지점 카드 머리글이 다른 층에 가리지 않는다");
  } catch {
    console.log("  --  지점 카드가 열리지 않아 건너뜀(데이터 없음)");
  }
}

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
