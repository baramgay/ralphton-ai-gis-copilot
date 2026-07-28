import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const WAIT_MS = Number(process.env.WAIT_MS ?? 150_000);
if (WAIT_MS > 0) {
  process.stdout.write(`배포 대기 ${WAIT_MS / 1000}초...\n`);
  await new Promise((r) => setTimeout(r, WAIT_MS));
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const ask = async (q) => {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1800);
  return {
    notice: clean(await page.getByTestId("query-notice").textContent().catch(() => "")),
    caveat: clean(await page.getByTestId("query-caveat").textContent().catch(() => "")),
    first: clean(await page.locator(".rank-name").first().textContent().catch(() => "")),
    rows: (await page.locator(".rank-row").allTextContents()).length,
  };
};

const CASES = [
  // 부정문 — 예전엔 정반대를 답했다
  ["인구가 줄지 않은 동", (r) => /증감률이 높은/.test(r.notice), "부정문: 감소 아님"],
  ["카드매출이 늘지 않은 동", (r) => /감소 추세/.test(r.notice), "부정문: 감소 추세"],
  ["생활인구가 늘어나지 않는 곳", (r) => /감소/.test(r.notice), "부정문: 늘어나지 않는"],
  ["매출이 안 늘어나는 동", (r) => /감소/.test(r.notice), "부정문: 안 ~"],
  ["인구가 줄어드는 동", (r) => /감소율이 높은/.test(r.notice), "회귀: 부정 없는 감소"],

  // 고령화 속도 vs 수준
  ["노인 인구 비율 상승하는 곳", (r) => /빠르게 오르는/.test(r.notice), "고령화 속도"],
  ["고령비율 늘어나는 동", (r) => /빠르게 오르는/.test(r.notice), "고령화 속도"],
  ["고령비율 높은 동", (r) => /비율이 높은/.test(r.notice) && !/빠르게/.test(r.notice), "고령 수준 그대로"],
  ["고령비율 상승하는 시군구", (r) => /시군구/.test(r.notice), "고령화 속도 + 시군구"],

  // 값 조건 고지
  // 비율은 실제로 반영된다 — 305개 읍면동의 10% = 31행
  ["상위 10% 소득 지역", (r) => r.caveat === "" && r.rows === 31, "비율 반영"],
  ["하위 20% 소득 동", (r) => r.caveat === "" && r.rows === 61, "비율 반영(낮은 쪽)"],
  ["소득 100만원 이상인 동", (r) => /아직 걸러 주지 못합니다/.test(r.caveat), "값 조건 고지"],
  ["생활인구 5만 명 넘는 동", (r) => /아직 걸러 주지 못합니다/.test(r.caveat), "값 조건 고지"],
  ["카드매출 상위 5곳만", (r) => r.caveat === "" && r.rows === 5, "개수는 실제로 반영"],
  ["생활인구 많은 동", (r) => r.caveat === "", "조건 없으면 고지 없음"],
];

let pass = 0;
const failures = [];
for (const [q, check, why] of CASES) {
  const r = await ask(q);
  const ok = check(r);
  if (ok) pass += 1;
  else failures.push({ q, why, ...r });
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} (${r.rows}행 1위=${r.first})`);
  console.log(`    안내 ${r.notice.slice(0, 110)}`);
  if (r.caveat) console.log(`    고지 ${r.caveat.slice(0, 110)}`);
}
if (failures.length) {
  console.log("\n=== 어긋난 것 ===");
  for (const f of failures) console.log(`"${f.q}" (${f.why})\n  안내: ${f.notice}\n  고지: ${f.caveat}`);
}
console.log(`\n통과 ${pass}/${CASES.length} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === CASES.length && errors.length === 0 ? 0 : 1);
