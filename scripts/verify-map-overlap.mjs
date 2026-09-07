/*
 * 지도 위에 떠 있는 것들이 **서로 덮지 않는지** 배포본에서 잰다.
 *
 * 이 검사가 없어서 같은 결함을 두 번 다르게 고쳤다. 좌상단 칩과 질의창은 둘 다 위쪽
 * 1rem 에 있었고, 「칩은 좁으니까 안 닿는다」가 유일한 근거였다. 레이어 이름이 길어지자
 * (「안전 · 자동차 천대당 교통사고 · 시군구 · 2025-12」) 칩이 가운데로 뻗어 질의창 밑으로
 * 들어갔다. 폭을 좁히는 패치를 두 번 넣었고 두 번 다 다른 폭에서 다시 겹쳤다 —
 * 폭은 내용이 정하기 때문이다.
 *
 * 그래서 여기서는 **긴 라벨이 걸린 상태**로 여러 폭에서 실제 사각형을 재고 겹치면 붉게
 * 낸다. 빌드·tsc·lint 는 이것을 못 본다. 겹침은 화면에만 있다.
 *
 * 함께 재는 것:
 *   - 칩이 한 줄인가(두 줄이 되면 높이가 내용에 따라 달라져 아래 배치가 다시 흔들린다)
 *   - 호버 말풍선이 세로로 접히지 않았는가(카카오 오버레이 칸은 폭이 0이라 한글이
 *     한 글자씩 선다 — 실제로 그렇게 나갔다)
 *
 * 실행: node scripts/verify-map-overlap.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
/* 긴 라벨을 만드는 질의. 짧은 기본 라벨로 재면 겹침이 있어도 초록이 나온다. */
const LONG_LABEL_QUERY = "교통사고 많이 발생한곳";
const WIDTHS = [1920, 1600, 1500, 1400, 1360, 1300, 1281, 1280, 1100, 900, 820];

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
  try {
    await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
    await page.getByTestId("onboard-card").waitFor({ state: "detached", timeout: 5_000 });
  } catch {
    // 안내를 이미 본 프로필이면 카드가 없다. 정상이다.
  }

  const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
  await box.fill(LONG_LABEL_QUERY);
  await box.press("Enter");
  /* 안내 줄까지 자리를 잡아야 질의창의 진짜 높이가 나온다. */
  await page.waitForTimeout(8_000);

  const measured = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      return { x: b.x, y: b.y, w: b.width, h: b.height, text: (el.textContent ?? "").trim() };
    };
    return {
      chip: rect(".map-chip-topleft"),
      hero: rect(".query-hero"),
      legend: rect(".map-legend"),
      bar: rect(".map-float-bar"),
      badge: rect(".map-context-badge"),
    };
  });

  const overlaps = (a, b) =>
    a !== null &&
    b !== null &&
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h;

  const pairs = [
    ["칩", "chip", "질의창", "hero"],
    ["칩", "chip", "범례", "legend"],
    ["질의창", "hero", "범례", "legend"],
    ["질의창", "hero", "조작 줄", "bar"],
    ["질의창", "hero", "아래 배지", "badge"],
  ];

  console.log(`\n[${width}px]`);
  check(measured.chip !== null, `${width}px · 좌상단 칩이 있다`);
  check(measured.hero !== null, `${width}px · 질의창이 있다`);

  for (const [aName, aKey, bName, bKey] of pairs) {
    const a = measured[aKey];
    const b = measured[bKey];
    if (a === null || b === null) continue;
    check(!overlaps(a, b), `${width}px · ${aName}과 ${bName}이 안 겹친다`, overlaps(a, b) ? `${aName} ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)} / ${bName} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : "");
  }

  /*
   * 칩은 한 줄이어야 한다. 두 줄이 되는 순간 높이가 라벨 길이에 따라 달라지고, 아래로
   * 자리를 잡은 것들이 다시 흔들린다. 한 줄 높이는 40px 안쪽이다(실측 31px).
   */
  if (measured.chip) {
    check(measured.chip.h <= 40, `${width}px · 칩이 한 줄이다`, `${Math.round(measured.chip.h)}px`);
  }

  await context.close();
}

/* 호버 말풍선은 넓은 화면에서 한 번만 본다. 접힘은 폭과 무관한 오버레이 문제다. */
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
  try {
    await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
  } catch {
    // 안내 카드가 없으면 그대로 간다.
  }
  const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
  await box.fill(LONG_LABEL_QUERY);
  await box.press("Enter");
  await page.waitForTimeout(9_000);

  const map = await page.locator(".copilot-map").boundingBox();
  let tip = null;
  /*
   * 바다 위에서는 아무것도 안 뜬다. 경남 육지에 닿을 때까지 훑는다. 카카오 키가 없는
   * 자리(로컬)에서는 도형 지도가 대신 뜨므로 그쪽 말풍선도 같은 잣대로 잰다.
   */
  const spots = [];
  for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
    for (let fy = 0.35; fy <= 0.75; fy += 0.05) spots.push([fx, fy]);
  }
  for (const [fx, fy] of spots) {
    await page.mouse.move(map.x + map.width * fx, map.y + map.height * fy);
    await page.waitForTimeout(250);
    tip = await page.evaluate(() => {
      const el =
        document.querySelector(".kakao-map-tooltip") ?? document.querySelector(".map-hover-chip");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { kind: el.className, w: b.width, h: b.height, text: (el.textContent ?? "").trim() };
    });
    if (tip) break;
  }

  console.log("\n[호버 말풍선]");
  check(tip !== null, "지도를 짚으면 말풍선이 뜬다");
  if (tip) {
    /*
     * 세로로 접히면 폭이 한 글자(약 20px)가 되고 높이가 글자 수만큼 자란다.
     * 폭이 높이보다 크면 가로로 선 것이다.
     */
    check(tip.w > tip.h, "말풍선이 가로로 선다", `${tip.kind} ${Math.round(tip.w)}x${Math.round(tip.h)} · ${tip.text}`);
    check(tip.h <= 80, "말풍선이 두세 줄을 넘지 않는다", `${Math.round(tip.h)}px`);
  }
  await context.close();
}

await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
