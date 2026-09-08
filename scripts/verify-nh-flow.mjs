/*
 * 배포본에서 **돈 흐름**이 실제로 값을 채우는지 잰다.
 *
 * 사람 흐름 검사와 같은 이유다. 목록은 조용히 비기 쉽다 — 자료 파일이 배포에 안
 * 실려도, 지역 코드가 안 맞아도, 기준월이 어긋나도 화면은 「빈 칸」 하나로 똑같이
 * 보인다. 그리고 빈 칸은 **돈이 안 돈다**는 뜻으로 읽힌다. 빌드·tsc·lint는 그 빈
 * 칸을 못 본다.
 *
 * 유출 파일이 없어 들어오는 쪽만 있다. 나가는 쪽 칸을 찾지 않는다 — 없는 칸을
 * 재면 없는 게 정상이라 항상 붉어진다.
 *
 * 실행: node scripts/verify-nh-flow.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";

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
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 90_000 });
try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
  await page.getByTestId("onboard-card").waitFor({ state: "detached", timeout: 8_000 });
} catch {
  // 안내를 이미 본 프로필이면 카드가 없다.
}

/* 자료 파일이 배포에 실렸는가. 화면이 비는 가장 흔한 이유다. */
const fileStatus = await page.evaluate(async () => {
  const response = await fetch("/data/flows/nh-flow.json");
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json();
  return { ok: true, regions: data.regions?.length ?? 0, months: data.months?.length ?? 0 };
});
check(fileStatus.ok, "돈 흐름 자료가 배포본에 있다", JSON.stringify(fileStatus));
check(fileStatus.regions === 22, "경남 시군구 22곳이 모두 실렸다", `${fileStatus.regions}곳`);
check(fileStatus.months === 12, "12개월이 실렸다", `${fileStatus.months}개월`);

/* 김해를 골라 돈 흐름 칸을 연다. 공유 링크가 선택을 대신한다. */
await page.goto(`${URL.replace(/\/$/, "")}/?region=48250`, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 90_000 });
const money = page.getByTestId("money-flow");
await money.waitFor({ timeout: 60_000 }).catch(() => {});
check(await money.isVisible().catch(() => false), "돈 흐름 칸이 뜬다");

if (await money.isVisible().catch(() => false)) {
  await money.locator("summary").click();
  await page.waitForTimeout(1200);
  const text = clean(await money.textContent());

  check(!/자료를 불러오지 못했습니다/.test(text), "자료를 받아 온다", text.slice(0, 90));
  check(!/돈 흐름 자료가 없습니다/.test(text), "선택 지역의 돈 흐름이 있다");

  /*
   * 값이 진짜 들어찼는지 본다. 「자료 없음」만 있거나 목록이 비면 자료 결손이
   * 「돈이 안 돈다」로 인쇄된다 — 금액과 비중이 함께 보여야 한다.
   */
  const inbound = clean(await money.getByTestId("money-flow-inbound").textContent().catch(() => ""));
  const hasMoney = (value) => /[1-9][\d,]*백만원/.test(value);
  check(hasMoney(inbound), "오는 곳 목록에 금액이 찍힌다", inbound.slice(0, 90));
  check(/\d+\.\d%/.test(inbound), "비중이 함께 찍힌다", inbound.slice(0, 60));

  /* 상대 지역 이름이 비면 순위만 남는다. 이름을 실제로 읽는다. */
  check(/[가-힣]{2,}(시|군|구)/.test(inbound), "상대 지역 이름이 한글로 적힌다");

  check(/같은 시군구 거주자가 쓴 돈은 빼고/.test(text), "관내를 뺐다고 밝힌다");
  check(/카드사 가맹점 기준 추정치/.test(text), "추정값임을 밝힌다");
  check(/경남빅데이터허브플랫폼/.test(text), "출처에 창구가 적힌다");
}

/* 말로 물으면 지역 상세로 가서 돈 흐름을 펼치라고 안내한다. */
const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
await box.fill("김해 돈은 어디서 와?");
await box.press("Enter");
await page.waitForTimeout(2500);
const shellText = clean(await page.getByTestId("copilot-shell").textContent());
check(/돈 흐름을 표시합니다/.test(shellText), "돈 질문에 돈 흐름 안내가 뜬다");

check(pageErrors.length === 0, "화면 오류가 없다", pageErrors.slice(0, 2).join(" / "));

await browser.close();
console.log(`\n통과 ${pass}건${failures.length ? ` · 실패 ${failures.length}건: ${failures.join(", ")}` : ""}`);
process.exit(failures.length === 0 ? 0 : 1);
