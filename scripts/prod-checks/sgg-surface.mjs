import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const WAIT_MS = Number(process.env.WAIT_MS ?? 170_000);
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
await page.waitForTimeout(4000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const ask = async (q) => {
  await page.getByLabel("분석 질의").fill(q);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(2600);
  return {
    notice: clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")),
    method: clean(await page.getByTestId("method-summary").textContent({ timeout: 1500 }).catch(() => "")),
    summary: clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => "")),
    rows: (await page.locator(".rank-row").allTextContents()).length,
    panel: clean(await page.locator("[data-testid=result-panel]").innerText().catch(() => "")),
  };
};

const SGG = ["총인구 많은 시군구", "고령비율 높은 시군구", "세대수 많은 시군구", "출생 많은 시군구", "1인가구 많은 시군구"];
const CASES = [
  ...SGG.map((q) => [q, (r) => r.rows === 22, "22개 전부"]),
  ...SGG.map((q) => [q, (r) => !/개 행정동/.test(r.panel), "패널 어디에도 '행정동'이 없음"]),
  ...SGG.map((q) => [q, (r) => !/시군구을|시군구은|시군구과/.test(r.panel), "조사가 맞음"]),
  ["세대수 많은 동", (r) => !/의료취약지수/.test(r.method) && /세대/.test(r.method), "방법론: 세대수"],
  ["총인구 많은 동", (r) => !/의료취약지수/.test(r.method), "방법론: 총인구"],
  ["고령비율 높은 동", (r) => !/의료취약지수/.test(r.method), "방법론: 고령비율"],
  ["고령비율 상승하는 동", (r) => /%포인트|고령비율/.test(r.method), "방법론: 고령화 속도"],
  ["의료 취약한 동", (r) => /의료기관 부족|취약/.test(r.method), "회귀: 의료는 의료 산식"],
  ["카드매출 높은 동", (r) => /카드매출/.test(r.method), "회귀: 민간 큐브"],
  ["총인구 많은 동", (r) => r.rows === 20, "회귀: 행정동은 상위 20"],
];

let pass = 0;
const failures = [];
for (const [q, check, why] of CASES) {
  const r = await ask(q);
  const ok = check(r);
  if (ok) pass += 1;
  else failures.push({ q, why, ...r });
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} (${r.rows}행)`);
  console.log(`    방법론 ${r.method.slice(0, 100)}`);
}
if (failures.length) {
  console.log("\n=== 어긋난 것 ===");
  for (const f of failures) console.log(`"${f.q}" (${f.why})\n  안내: ${f.notice}\n  방법론: ${f.method}\n  패널: ${f.panel.slice(0, 200)}`);
}
console.log(`\n통과 ${pass}/${CASES.length} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === CASES.length && errors.length === 0 ? 0 : 1);
