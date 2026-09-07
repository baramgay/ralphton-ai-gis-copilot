/*
 * 권한 질문을 눌렀을 때 **답이 나오는지** 배포본에서 본다.
 *
 * 로컬 검사로는 이것을 볼 수 없다. 데모 스냅샷에는 약국이 169곳 들어 있어서 「약국만
 * 보여줘」가 로컬에서는 멀쩡히 답한다. 그런데 배포본은 심평원 병원정보서비스로 시설을
 * 갈아 끼우고, 그 자료에는 약국이 **한 곳도 없다**(2026-09-06 실측 · 4,272곳 전건).
 * 운영시간도 전건 비어 있어 「야간 진료 병원」도 0건이었다.
 *
 * 즉 "규칙이 질의를 해석하는가"는 초록인데 "자료가 있는가"는 붉은 상태가 조용히 성립한다.
 * 제품이 먼저 권한 질문이 0건을 내놓는 것은 답을 못 하는 것보다 나쁘다 — 없는 기능을
 * 있다고 말한 셈이기 때문이다.
 *
 * 그래서 화면에 실제로 떠 있는 추천 칩을 읽어, 하나씩 눌러 보고 결과가 비었는지 센다.
 *
 * 실행: node scripts/verify-suggestions-prod.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

const chips = await page.locator(".query-hero-chip").allInnerTexts();
check(chips.length > 0, "추천 질문이 화면에 있다", `${chips.length}개`);

/*
 * 비었다는 판정은 **개수**로 한다. 문구로 재면 문구가 바뀌는 날 검사가 눈을 감는다.
 * 결과 메타는 "30개 행정동" 또는 "1,361개 시설" 꼴이라 앞의 수만 보면 된다.
 */
const resultCount = async () => {
  const text = (await page.getByTestId("result-meta").innerText().catch(() => "")) ?? "";
  const matched = text.replace(/,/g, "").match(/(\d+)\s*개/);
  return matched ? Number(matched[1]) : null;
};

for (const chip of chips) {
  const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
  await box.fill(chip);
  await box.press("Enter");
  /* 결과가 그려지기 전에 세면 앞 질문의 개수를 읽는다. 값이 자리 잡을 때까지 기다린다. */
  await page.waitForTimeout(7_000);
  const count = await resultCount();
  check(count !== null && count > 0, `「${chip}」에 답이 있다`, count === null ? "개수를 못 읽음" : `${count}개`);
}

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
