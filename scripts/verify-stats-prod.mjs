/*
 * 상관·이상치를 **배포본에서** 잰다.
 *
 * 2026-09-04 외부 검증이 잡은 결함 셋은 전부 화면에 인쇄된 문장이었다. 계산은 맞는데
 * 화면이 다른 말을 하고 있었던 것이다:
 *
 *  - 18줄을 보여 주면서 「표본 22개」라고 적었다(같은 화면에서 표본이 둘이었다)
 *  - 「1위 창원시(0점)」 — 칠할 지도가 없어 박아 둔 0이 점수로 인쇄됐다
 *  - 2024년 값과 2025년 값을 견주면서 시점을 말하지 않았다
 *
 * 셋 다 유닛 검사로도 걸었지만, 셋 다 **배포본에서 발견됐다.** 그러니 배포본에서 다시
 * 잰다. 판정은 화면에 실제로 찍힌 글자로 한다.
 *
 * 실행: node scripts/verify-stats-prod.mjs [URL]
 * 종료 코드로 판정한다(초록 0 / 붉음 1). 파이프로 넘기면 종료 코드가 가려지므로
 * 로그 파일로 받아라.
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
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

async function ask(query) {
  const input = page.getByLabel("분석 질의");
  await input.fill(query);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.getByTestId("result-panel").waitFor({ timeout: 30_000 });
  /*
   * 큐브가 아직 없으면 화면은 「레이어를 불러오는 중입니다」를 띄우고 **이전 결과를
   * 그대로 둔다**. 고정 1.2초로 재면 첫 질의에서 옛 화면을 새 답으로 읽는다 — 실제로
   * 첫 질의만 5건 실패로 나왔고 두 번째 질의는 통과했다. 알림이 「중입니다」에서
   * 벗어날 때까지 기다린다.
   */
  await page
    .waitForFunction(
      () => {
        const notice = document.querySelector('[data-testid="query-notice"]');
        return !notice || !/중입니다/.test(notice.textContent ?? "");
      },
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1_200);
  return {
    // 결과 패널 전체 글자. 「(0점)」은 해석문에, 「표본 n개」는 산식 각주에 있다.
    text: await page.getByTestId("result-panel").innerText(),
    rows: await page.locator(".rank-row").count(),
  };
}

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });
try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
} catch {
  // 안내를 이미 본 프로필이면 카드가 없다. 정상이다.
}

console.log("\n=== 재정자립도 × 빈집 비율 ===");
const vacant = await ask("재정자립도와 빈집 비율의 상관관계");

/*
 * 「표본 n개」와 실제로 보여 주는 줄 수가 같아야 한다. 이 둘이 갈라져 있던 것이
 * 결함을 확정한 근거였으므로, 문구만 보지 않고 **줄을 세어** 맞춰 본다.
 */
const stated = vacant.text.match(/표본 (\d+)개 시군구/);
check(Boolean(stated), "표본 수를 화면에 적는다", stated?.[0] ?? "(문구 없음)");
check(stated?.[1] === "18", "표본이 18개다(창원 5개 구는 한 관측)", stated?.[1] ?? "-");
check(
  vacant.rows === Number(stated?.[1]),
  "보여 주는 줄 수와 표본 수가 같다",
  `줄 ${vacant.rows} · 표본 ${stated?.[1]}`,
);
check(vacant.text.includes("창원시 5개 구"), "왜 접었는지 적는다");
check(!vacant.text.includes("(0점)"), "없는 점수를 0점으로 인쇄하지 않는다");
check(
  /1위 [^(]+\([\d.]+%\)/.test(vacant.text),
  "상위 지역에 점수 대신 실제 지표 값을 적는다",
  vacant.text.match(/상위 지역: [^\n]{0,60}/)?.[0] ?? "(문구 없음)",
);

console.log("\n=== 재정자립도 × 화재 발생률 (시점이 어긋나는 쌍) ===");
const fire = await ask("재정자립도와 화재 발생률의 상관관계");
check(fire.text.includes("기준 시점이 다릅니다"), "어긋난 시점을 밝힌다");
check(
  fire.text.includes("2024-12") && fire.text.includes("2025-12"),
  "어느 해와 어느 해인지 적는다",
  fire.text.match(/기준 시점이 다릅니다[^\n]{0,80}/)?.[0] ?? "(문구 없음)",
);

console.log("\n=== 뺑소니율 이상치 (한 지표 안에서 시점이 갈리는 경우) ===");
const hitrun = await ask("뺑소니율이 튀는 시군구");
check(hitrun.text.includes("최신 시점이 다릅니다"), "한 지표 안의 시점 혼합도 밝힌다");

check(errors.length === 0, "JS 에러 없음", errors.slice(0, 2).join(" | "));

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
