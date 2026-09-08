/*
 * 배포본에 **자료를 내준 창구가 적혀 있는지** 잰다.
 *
 * 이 도구가 쓰는 레이어 23개 중 13개, 지표 81개 중 49개가 경남빅데이터허브플랫폼에서
 * 온 자료다. 그런데 화면에는 기관 약칭(SKT·NH·KCB)만 있었고 창구 이름은 **어디에도
 * 없었다** — 출처를 물으면 「SKT」라고만 답하는 셈이었다.
 *
 * 이름 한 줄은 조용히 사라진다. 문구를 다듬다가, 묶음을 다시 짜다가, 요약을 줄이다가.
 * 빌드·tsc·lint 는 사라진 이름을 못 본다. 그래서 배포본에서 눈으로 보이는 자리마다
 * 실제로 읽어 확인한다.
 *
 * 함께 재는 것: 창구를 적었다고 **기관 이름이 밀려나면 안 된다**. 창구는 기관을
 * 대신하는 것이 아니라 옆에 붙는 것이다.
 *
 * 실행: node scripts/verify-hub-attribution.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const HUB = "경남빅데이터허브플랫폼";

let pass = 0;
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(label);
};

const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 90_000 });

/* 1) 첫 화면 안내. 처음 온 사람이 제일 먼저 읽는 자리다. */
const onboard = page.getByTestId("onboard-card");
if (await onboard.isVisible().catch(() => false)) {
  const text = clean(await onboard.textContent());
  check(text.includes(HUB), "30초 안내가 창구를 부른다", text.slice(0, 90));
  await page.locator('[data-testid="onboard-card"] button').last().click();
  await onboard.waitFor({ state: "detached", timeout: 8_000 }).catch(() => {});
} else {
  /* 안내를 이미 본 프로필이면 카드가 없다. 없는 것을 실패로 세지 않는다. */
  console.log("  --  30초 안내 카드 없음(이미 본 프로필) · 건너뜀");
}

/* 2) 활용 데이터 패널. 「무엇을 썼는가」를 답하는 자리. */
await page.getByRole("button", { name: "활용데이터" }).click();
const inventory = page.getByTestId("data-inventory");
await inventory.waitFor({ timeout: 30_000 });

const summary = page.getByTestId("hub-channel-summary");
await summary.waitFor({ timeout: 10_000 }).catch(() => {});
const summaryText = clean(await summary.textContent().catch(() => ""));
check(summaryText.includes(HUB), "활용 데이터 머리에 창구가 있다", summaryText.slice(0, 110));
/* 개수를 손으로 적으면 레이어가 늘 때 틀린다. 실제 숫자가 찍혔는지 본다. */
check(/레이어 \d+개 · 지표 \d+개/.test(summaryText), "창구 합계가 숫자로 적힌다", summaryText.slice(0, 110));

/* 3) 제공기관 묶음마다 창구 한 줄. 접힌 것을 펴야 보인다. */
for (const provider of ["SKT", "NH", "KCB"]) {
  const group = inventory.locator("details", { hasText: provider }).first();
  await group.locator("summary").click();
  await page.waitForTimeout(400);
  const text = clean(await group.textContent());
  check(text.includes(`제공 창구 · ${HUB}`), `${provider} 묶음에 창구가 적힌다`);
  check(text.includes(provider), `${provider} 이름이 창구에 밀려나지 않았다`);
}

/* 4) 레이어를 바꿀 때 뜨는 출처 문구. 이 문장이 보고서로 옮겨진다. */
await page.getByRole("button", { name: "조작" }).click().catch(() => {});
const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
await box.fill("생활인구 많은 동네");
await box.press("Enter");
await page.waitForTimeout(9_000);

const shell = clean(await page.getByTestId("copilot-shell").textContent());
check(shell.includes(HUB), "레이어 전환 안내가 창구를 밝힌다");
check(shell.includes("SKT"), "그 안내에 제공기관 이름도 남아 있다");

await browser.close();
console.log(`\n통과 ${pass}건${failures.length ? ` · 실패 ${failures.length}건: ${failures.join(", ")}` : ""}`);
process.exit(failures.length === 0 ? 0 : 1);
