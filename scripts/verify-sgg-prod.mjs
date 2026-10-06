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
import { chromium, expect } from "@playwright/test";

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
const results = page.getByTestId("workspace-results-toggle");
if (await results.getAttribute("aria-pressed") !== "true") await results.click();
await expect(page.getByTestId("result-panel")).toContainText("재정자립도 기준 상위", { timeout: 30_000 });
await page.getByRole("tab", { name: "순위", exact: true }).click();
const text = await page.getByTestId("map-view-chip").innerText();
check(/시군구/.test(text), "결과가 시군구 단위다", text);
const ranked = page.locator("#result-view-rank .rank-row");
check(await ranked.count() === 22, "22개 시군구 순위가 있다", `${await ranked.count()}개`);
check(/^1\s/.test(await ranked.first().innerText()), "1위가 있다", await ranked.first().innerText());
// 펼친 결과 패널이 지도 중심을 덮지 않도록 접은 뒤 실제 지도를 짚는다.
await results.click();
await page.waitForFunction(() => document.querySelectorAll("[data-map-engine] path").length > 20, null, { timeout: 60_000 });

/*
 * 새 작업 영역 아래 실제 지도에서 육지 좌표를 찾고 호버·클릭을 함께 검증한다.
 * 결과 텍스트만으로 지도 상호작용이 작동한다고 판정하지 않는다.
 */
const mapBox = await page.locator(".copilot-map").boundingBox();
if (!mapBox) {
  check(false, "지도 영역을 찾는다");
} else {
  // 작업 영역 높이·패널 전환에 따라 중앙이 경계/바다에 걸릴 수 있다.
  // 실제 지역 말풍선이 생긴 좌표를 찾아 같은 좌표를 클릭한다.
  let point = null;
  const spots = [];
  for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
    for (let fy = 0.35; fy <= 0.75; fy += 0.05) spots.push([fx, fy]);
  }
  for (const [fx, fy] of spots) {
    const x = mapBox.x + mapBox.width * fx;
    const y = mapBox.y + mapBox.height * fy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    if (await page.getByTestId("map-hover-chip").isVisible().catch(() => false)) {
      point = { x, y };
      break;
    }
  }
  const chip = page.getByTestId("map-hover-chip");
  let hoveredName = "";
  const visible = (await chip.count()) > 0 && (await chip.first().isVisible().catch(() => false));
  check(visible, "지도 호버에 지역 칩이 뜬다");
  if (visible) {
    const chipText = await chip.first().innerText();
    hoveredName = chipText.split("\n")[0];
    // 시군구 이름 한 줄 + 값 한 줄. 동 이름(3토큰)이면 동 지도가 그대로다.
    check(/^[^\n]+\n.+/.test(chipText), "칩이 이름+값을 말한다", chipText.replace(/\n/g, " / ").slice(0, 80));
  }

  if (point) await page.mouse.click(point.x, point.y);
  if (await results.getAttribute("aria-pressed") !== "true") await results.click();
  await page.getByRole("tab", { name: "선택 지역", exact: true }).click();
  await expect(page.getByTestId("result-panel")).toContainText("선택한 시군구", { timeout: 10_000 });
  const body = await page.getByTestId("copilot-shell").innerText();
  check(point !== null && /선택한 시군구/.test(body), "클릭하면 시군구 선택 칸이 난다");
  check(hoveredName.length > 0 && (await page.locator("#result-view-region").innerText()).includes(hoveredName), "짚은 시군구가 선택 지역에 반영된다", hoveredName);
}

check(errors.length === 0, "JS 에러 없음", errors.slice(0, 2).join(" | "));

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
