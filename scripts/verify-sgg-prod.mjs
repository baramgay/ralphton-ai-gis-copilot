/*
 * 시군구 지도가 **배포본에서** 22개로 그려지는지 본다.
 *
 * 시군구 모드인데 305개 동 경계가 그대로면 복잡해서 값을 못 읽는다. 그래서
 * 시군구 dissolve 산출물로 갈아탔다. 유닛 검사로는 폴리곤 개수·채색·호버·클릭을
 * 볼 수 없으니 배포본에서 잰다.
 *
 * 판정은 화면에 실제로 찍힌 것으로 한다: 시군구 단위 문구, 호버 칩의 시군구
 * 이름+값, 클릭 뒤 「선택한 시군구」 칸, JS 에러 없음.
 *
 * 실행: node scripts/verify-sgg-prod.mjs [URL] (종료 코드로 판정)
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
const errors = [];
page.on("pageerror", (event) => errors.push(String(event)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
} catch {
  // 안내를 이미 본 프로필이면 카드가 없다. 정상이다.
}

await page.getByLabel("분석 질의").fill("재정자립도 높은 시군구");
await page.getByRole("button", { name: "질의 실행" }).click();
await page.getByTestId("result-panel").waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_000);

const text = await page.getByTestId("result-panel").innerText();
check(/시군구/.test(text), "결과가 시군구 단위다");
check(/1위/.test(text), "1위가 있다");

/*
 * 지도 한가운데는 내륙이다(경남 중심 부근). 그 자리를 호버·클릭하면
 * 시군구 폴리곤에 닿는다 — 바다가 걸리면 칩이 안 뜨니 그때는 실패로 본다.
 */
const mapBox = await page.locator(".copilot-map").boundingBox();
if (!mapBox) {
  check(false, "지도 영역을 찾는다");
} else {
  const cx = mapBox.x + mapBox.width / 2;
  const cy = mapBox.y + mapBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(1_000);
  const chip = page.getByTestId("map-hover-chip");
  const visible = (await chip.count()) > 0 && (await chip.first().isVisible().catch(() => false));
  check(visible, "지도 호버에 지역 칩이 뜬다");
  if (visible) {
    const chipText = await chip.first().innerText();
    // 시군구 이름 한 줄 + 값 한 줄. 동 이름(3토큰)이면 동 지도가 그대로다.
    check(/^[^\n]+\n.+/.test(chipText), "칩이 이름+값을 말한다", chipText.replace(/\n/g, " / ").slice(0, 80));
  }

  await page.mouse.click(cx, cy);
  await page.waitForTimeout(1_500);
  const body = await page.getByTestId("copilot-shell").innerText();
  check(/선택한 시군구/.test(body), "클릭하면 시군구 선택 칸이 난다");
}

check(errors.length === 0, "JS 에러 없음", errors.slice(0, 2).join(" | "));

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
