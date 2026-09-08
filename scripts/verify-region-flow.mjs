/*
 * 배포본에서 **사람 흐름**이 실제로 값을 채우는지 잰다.
 *
 * 흐름은 지역 한 쌍에 붙는 값이라 지도에 칠할 수 없고 목록으로만 나간다. 목록은 조용히
 * 비기 쉽다 — 자료 파일이 배포에 안 실려도, 지역 코드가 안 맞아도, 기준월이 어긋나도
 * 화면은 「빈 칸」 하나로 똑같이 보인다. 그리고 빈 칸은 **흐름이 없는 지역**으로 읽힌다.
 * 빌드·tsc·lint 는 그 빈 칸을 못 본다.
 *
 * 그래서 여기서는 값이 실제로 들어찼는지(인원·비중), 관내를 뺐다고 밝히는지, 추정값임을
 * 적는지를 배포본에서 읽는다.
 *
 * 실행: node scripts/verify-region-flow.mjs [URL] (종료 코드로 판정)
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
  const response = await fetch("/data/flows/skt-flow.json");
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json();
  return { ok: true, regions: data.regions?.length ?? 0, months: data.months?.length ?? 0 };
});
check(fileStatus.ok, "사람 흐름 자료가 배포본에 있다", JSON.stringify(fileStatus));
check(fileStatus.regions === 22, "경남 시군구 22곳이 모두 실렸다", `${fileStatus.regions}곳`);
check(fileStatus.months === 12, "12개월이 실렸다", `${fileStatus.months}개월`);

/* 지역을 골라야 패널이 뜬다. 질의 하나면 1위 지역이 선택된다. */
const box = page.getByPlaceholder("무엇이 궁금하세요", { exact: false }).first();
await box.fill("생활인구 많은 동네");
await box.press("Enter");

const flow = page.getByTestId("region-flow");
await flow.waitFor({ timeout: 60_000 }).catch(() => {});
check(await flow.isVisible().catch(() => false), "사람 흐름 칸이 뜬다");

if (await flow.isVisible().catch(() => false)) {
  await flow.locator("summary").click();
  await page.waitForTimeout(1200);
  const text = clean(await flow.textContent());

  check(!/자료를 불러오지 못했습니다/.test(text), "자료를 받아 온다", text.slice(0, 90));
  check(!/사람 흐름 자료가 없습니다/.test(text), "선택 지역의 흐름이 있다");

  /*
   * 값이 진짜 들어찼는지 본다. 「0명」만 있거나 목록이 비면 자료 결손이 「아무도 안 온다」로
   * 인쇄된다 — 인원과 비중이 함께 보여야 한다.
   */
  const inbound = clean(await flow.getByTestId("region-flow-inbound").textContent().catch(() => ""));
  const outbound = clean(await flow.getByTestId("region-flow-outbound").textContent().catch(() => ""));
  const hasPeople = (value) => /[1-9][\d,]*명/.test(value);
  check(hasPeople(inbound), "오는 곳 목록에 인원이 찍힌다", inbound.slice(0, 90));
  check(hasPeople(outbound), "가는 곳 목록에 인원이 찍힌다", outbound.slice(0, 90));
  check(/\d+\.\d%/.test(inbound), "비중이 함께 찍힌다", inbound.slice(0, 60));

  /* 상대 지역 이름이 비면 순위만 남는다. 이름을 실제로 읽는다. */
  check(/[가-힣]{2,}(시|군|구)/.test(inbound), "상대 지역 이름이 한글로 적힌다");

  check(/같은 시군구 안에서의 이동은/.test(text), "관내를 뺐다고 밝힌다");
  check(/이동통신 신호로 추정한 값/.test(text), "추정값임을 밝힌다");
  check(/경남빅데이터허브플랫폼/.test(text), "출처에 창구가 적힌다");
}

check(pageErrors.length === 0, "화면 오류가 없다", pageErrors.slice(0, 2).join(" / "));

await browser.close();
console.log(`\n통과 ${pass}건${failures.length ? ` · 실패 ${failures.length}건: ${failures.join(", ")}` : ""}`);
process.exit(failures.length === 0 ? 0 : 1);
