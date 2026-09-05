/*
 * 시안(docs/design/*.html)을 **상자와 히트 테스트로** 검사한다.
 *
 * 스크린샷을 눈으로 보면 「대체로 괜찮다」가 된다. 이 화면에서 이미 두 번 데인 결함
 * (질의창 도달 불가 · 카드가 지도를 덮음)은 전부 **눈으로는 괜찮아 보이는** 것이었다.
 * 그래서 세 가지를 기계로 묻는다.
 *
 *   1. 글자가 접히는가 — 상자 높이가 아니라 Range 의 줄 상자 수로 센다.
 *      flex 로 세로 가운데 맞춘 버튼은 한 줄이어도 상자가 높다. 높이로 재면 전부 거짓 양성.
 *   2. 눌러야 할 것이 가려지는가 — 겹침 넓이가 아니라 elementFromPoint 로 본다.
 *      겹쳐도 위가 투명하면 눌린다. 겹치지 않아도 그림자 층이 가리면 안 눌린다.
 *   3. 약속한 터치 표적이 실제로 그 크기인가 — TOKENS.md 가 44px 를 적어 둔 자리만.
 *      적지 않은 자리까지 재면 「제안하지 않은 것」을 결함으로 세게 된다.
 *
 * 실행: node scripts/verify-design-mockups.mjs (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SCREENS = [
  ["01-desktop-dark.html", 1440, 900],
  ["02-desktop-light.html", 1440, 900],
  ["03-mobile-map.html", 980, 830],
  ["04-mobile-sheet.html", 980, 830],
  ["05-contrast.html", 1440, 900],
  ["06-empty-loading-error.html", 1440, 900],
];

/** TOKENS.md §2 가 `--touch-min: 44px` 를 약속한 자리. 그 밖은 묻지 않는다. */
const TOUCH_PROMISED = ".map-float-btn, .sheet-snap-btn";

const findings = [];
const browser = await chromium.launch();

for (const [file, width, height] of SCREENS) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(path.resolve("docs/design", file)).href);
  await page.waitForTimeout(300);

  const report = await page.evaluate((touchSel) => {
    /* 접힘: 텍스트 노드를 Range 로 감싸 서로 다른 top 을 센다. */
    const lineCount = (el) => {
      const tops = new Set();
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return tops.size;
    };

    const wrapped = [];
    for (const el of document.querySelectorAll(".map-float-btn, .query-hero-chip, .sheet-snap-btn")) {
      const text = (el.textContent || "").trim();
      if (text && lineCount(el) > 1) wrapped.push(text);
    }

    /* 가림: 지점 카드 안 글자가 자기 자신에게 히트되는가. */
    const covered = [];
    const card = document.querySelector(".probe-card");
    if (card) {
      for (const el of card.querySelectorAll("*")) {
        if (el.children.length) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || !card.contains(hit))
          covered.push({ text: text.slice(0, 18), by: String(hit?.className || hit?.tagName || "?").slice(0, 30) });
      }
    }

    const small = [];
    for (const el of document.querySelectorAll(touchSel)) {
      const box = el.getBoundingClientRect();
      if (box.height > 0 && box.height < 44)
        small.push({ text: (el.textContent || "").trim().slice(0, 10), h: Math.round(box.height) });
    }
    return { wrapped, covered, small };
  }, TOUCH_PROMISED);

  console.log(`\n── ${file}`);
  const before = findings.length;
  for (const t of report.wrapped) findings.push(`${file}: 「${t}」 두 줄로 접힘`);
  for (const c of report.covered) findings.push(`${file}: 지점 카드 「${c.text}」 가림 ← ${c.by}`);
  for (const s of report.small) findings.push(`${file}: 「${s.text}」 ${s.h}px (약속 44px)`);
  for (const line of findings.slice(before)) console.log(`  !!  ${line.slice(file.length + 2)}`);
  if (findings.length === before) console.log("  OK  접힘·가림·표적 이상 없음");

  await page.close();
}

await browser.close();
console.log(findings.length === 0 ? "\n전부 통과" : `\n지적 ${findings.length}건`);
process.exit(findings.length === 0 ? 0 : 1);
