/*
 * 순위 목록의 **한 줄이 좁은 화면에서 눌리지 않는지** 잰다.
 *
 * 순위 행은 [번호][이름·설명][값]의 가로 배치다. 이름 칸이 `flex-1`(basis 0)이면
 * "0이어도 된다"고 말하는 것이라, 값이 길어지는 결과(교차분석의
 * "카드매출 31,841백만원 · 총인구 7,641명")에서 값이 줄을 다 먹고 이름 칸이 눌린다.
 * 2026-09-08 배포본 실측: 이름 21px, 설명 높이 227px — 글자가 한 자씩 세로로 떨어지고
 * 지역 이름은 "김…"만 남았다.
 *
 * 이 결함은 빌드·타입·lint가 못 본다. 요소는 존재하고 글자도 들어 있어
 * `toBeVisible`도 통과한다. 눌렸는지는 **너비를 재야만** 안다.
 *
 * 실행: node scripts/verify-rank-row.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
/* 값이 가장 긴 결과. 지표 두 개가 값·단위와 함께 한 줄에 들어간다. */
const QUERY = "카드매출 많고 총인구 적은 동네";
/* 이름 칸이 이보다 좁으면 글자가 세로로 떨어진다(한글 한 자 ≈ 14px). */
const MIN_NAME_WIDTH = 120;
/* 설명은 한 줄짜리 글이다. 세 줄을 넘으면 눌려서 접힌 것이다. */
const MAX_NOTE_HEIGHT = 60;

let pass = 0;
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(label);
};

const browser = await chromium.launch();

for (const width of [390, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 90_000 });
  try {
    await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
    await page.getByTestId("onboard-card").waitFor({ state: "detached", timeout: 8_000 });
  } catch {
    // 안내를 이미 본 프로필이면 카드가 없다.
  }

  const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
  await box.fill(QUERY);
  await box.press("Enter");
  await page.locator(".rank-row .rank-value").first().waitFor({ timeout: 60_000 }).catch(() => {});

  const rows = await page.evaluate(() => {
    const size = (node) =>
      node ? { w: Math.round(node.getBoundingClientRect().width), h: Math.round(node.getBoundingClientRect().height) } : null;
    return [...document.querySelectorAll(".rank-row")]
      .filter((row) => row.querySelector(".rank-value"))
      .slice(0, 5)
      .map((row) => ({
        name: size(row.querySelector(".rank-name")),
        note: size(row.querySelector(".rank-note")),
        value: (row.querySelector(".rank-value")?.textContent ?? "").trim(),
      }));
  });

  check(rows.length >= 3, `${width}px · 순위 행을 읽었다`, `${rows.length}행`);
  if (rows.length === 0) {
    await page.close();
    continue;
  }

  const narrow = rows.filter((row) => (row.name?.w ?? 0) < MIN_NAME_WIDTH);
  check(
    narrow.length === 0,
    `${width}px · 지역 이름 칸이 눌리지 않는다`,
    `가장 좁은 칸 ${Math.min(...rows.map((row) => row.name?.w ?? 0))}px`,
  );

  const stacked = rows.filter((row) => (row.note?.h ?? 0) > MAX_NOTE_HEIGHT);
  check(
    stacked.length === 0,
    `${width}px · 설명이 세로로 떨어지지 않는다`,
    `가장 높은 설명 ${Math.max(...rows.map((row) => row.note?.h ?? 0))}px`,
  );

  /* 값이 아랫줄로 내려가더라도 지워지면 안 된다. */
  check(rows.every((row) => /\d/.test(row.value)), `${width}px · 값이 그대로 찍힌다`, rows[0].value.slice(0, 40));

  const overflow = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  check(overflow[0] <= overflow[1] + 1, `${width}px · 가로로 넘치지 않는다`, overflow.join(" / "));

  await page.close();
}

await browser.close();
console.log(`\n통과 ${pass}건${failures.length ? ` · 실패 ${failures.length}건: ${failures.join(", ")}` : ""}`);
process.exit(failures.length === 0 ? 0 : 1);
