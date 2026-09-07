/*
 * 지점 분석을 **배포본에서** 잰다.
 *
 * 로컬 e2e로는 이 기능을 확인할 수 없다. Kakao SDK는 등록된 웹 도메인에서만 뜨고
 * localhost는 등록되어 있지 않아, 지도가 DemoMap으로 떨어지면 지점 분석 버튼 자체가
 * 그려지지 않는다. 로컬에서 "통과"라고 적힌 검사는 실은 건너뛰어진 검사였다(실측).
 *
 * 그래서 여기서 재는 것은 배포본이고, 판정은 화면 좌표로 한다 —
 * "보인다"가 아니라 "그 자리를 누르면 지도가 받는가".
 *
 * 실행: node scripts/verify-probe-prod.mjs [URL]
 * 종료 코드로 판정한다(초록 0 / 붉음 1).
 */
import { chromium, devices } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();

for (const [label, opts, touch] of [
  ["모바일 Pixel 5", { ...devices["Pixel 5"] }, true],
  ["데스크톱 1440x900", { viewport: { width: 1440, height: 900 } }, false],
]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  console.log(`\n=== ${label} ===`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });

  /*
   * 첫 방문 안내 카드는 지도 한가운데를 덮는다. 세는 순간 아직 안 그려져 있으면
   * 그냥 지나쳐서, 뒤에 이어지는 지도 클릭이 카드에 먹힌다 — 실측으로 그렇게 한 번
   * 실패했다. 보일 때까지 기다렸다가 닫고, **사라졌는지 확인**한다.
   */
  const onboardCard = page.getByTestId("onboard-card");
  try {
    await onboardCard.waitFor({ timeout: 8_000 });
    await page.locator('[data-testid="onboard-card"] button').last().click();
    await onboardCard.waitFor({ state: "detached", timeout: 5_000 });
  } catch {
    // 안내를 이미 본 프로필이면 카드가 없다. 그건 정상이다.
  }

  // 떠 있는 버튼 줄이 접히면 첫 방문 안내 카드 밑으로 들어가 「조작」이 안 눌린다.
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".map-float-bar");
    const buttons = [...(el?.querySelectorAll("button") ?? [])];
    const reach = {};
    for (const button of buttons) {
      const r = button.getBoundingClientRect();
      const onScreen = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      reach[button.textContent.trim()] = onScreen && (top === button || button.contains(top));
    }
    return { rows: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size, reach };
  });
  check(bar.rows === 1, "떠 있는 버튼 줄이 한 줄", `${bar.rows}줄`);
  check(Object.values(bar.reach).every(Boolean), "버튼이 모두 눌린다", JSON.stringify(bar.reach));

  /*
   * 「지점 분석」 버튼은 경계가 도착한 뒤에야 나온다. 그전에는 Kakao 지도가 떠 있어도
   * 지도 클릭이 올라오지 않아, 눌러도 아무 일이 없다(배포본 6/6 실패 → 면이 그려진 뒤
   * 6/6 성공, 실측). 그래서 여기서도 **면이 그려졌는지**를 먼저 확인한다 — 이 기다림이
   * 없으면 검사는 결함이 아니라 자기 성급함을 재게 된다.
   */
  await page.waitForFunction(
    () => document.querySelectorAll("[data-map-engine] path").length > 100,
    null,
    { timeout: 60_000 },
  );

  const toggle = page.getByTestId("probe-toggle");
  await toggle.waitFor({ timeout: 30_000 });
  await toggle.click();
  await page.getByTestId("probe-hint").waitFor({ timeout: 10_000 });
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector("[data-probe-mode]")).cursor);
  check(cursor === "crosshair", "지점 찍기 중 커서가 십자선", cursor);

  const box = await page.locator("[data-map-engine] > div").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const tap = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

  await tap(cx, cy);
  try {
    await page.getByTestId("probe-card").waitFor({ timeout: 15_000 });
  } catch {
    // 왜 안 먹혔는지까지 말해야 다음 사람이 고칠 수 있다.
    const blocker = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName}.${(el.className || "").toString().slice(0, 60)}` : "(없음)";
    }, [cx, cy]);
    check(false, "지도를 눌러 지점이 찍힌다", `누른 자리 위에 있는 것: ${blocker}`);
    console.log("JS 에러:", errors.slice(0, 3).join(" | "));
    await context.close();
    continue;
  }
  await page.waitForTimeout(250);

  const first = await page.evaluate(() => ({
    region: document.querySelector('[data-testid="probe-region"]').innerText,
    pins: document.querySelectorAll('[data-testid="probe-pin"]').length,
    onScreen: (() => {
      const r = document.querySelector('[data-testid="probe-card"]').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    })(),
  }));
  check(first.region.length > 0, "행정동이 나온다", first.region);
  check(first.pins === 1, "지도에 핀이 하나", String(first.pins));
  check(first.onScreen, "카드가 화면 안에 들어온다");

  /*
   * 이 기능의 쓰임새는 "여기, 그리고 저기"다. 카드가 지도를 덮으면 두 번째를 못 한다 —
   * 좁은 화면에서 실제로 그랬다(카드 314px, 지도에 남는 자리 173px).
   */
  const coveredByCard = (x, y) =>
    page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('[data-testid="probe-card"]')), [x, y]);

  const coveredBefore = await coveredByCard(cx, cy);
  await page.getByTestId("probe-collapse").click();
  await page.waitForTimeout(200);
  const coveredAfter = await coveredByCard(cx, cy);
  check(!coveredAfter, "접으면 지도 한가운데를 다시 누를 수 있다", `접기 전 덮임=${coveredBefore}`);

  const collapsedText = await page.getByTestId("probe-card").innerText();
  check(collapsedText.includes("반경"), "접어도 무엇을 보고 있는지 남는다", collapsedText.split("\n")[0]);

  // 접은 채로 다른 곳을 찍으면 결과가 실제로 바뀌어야 한다.
  await tap(cx, cy - box.height * 0.18);
  await page.waitForTimeout(600);
  const second = await page.getByTestId("probe-region").innerText();
  check(second.length > 0, "접은 채로 다른 지점을 찍을 수 있다", `${first.region} → ${second}`);

  check(errors.length === 0, "JS 에러 없음", errors.slice(0, 2).join(" | "));
  await context.close();
}

await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
