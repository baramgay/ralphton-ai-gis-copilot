import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";
const WAIT_MS = Number(process.env.WAIT_MS ?? 170_000);
if (WAIT_MS > 0) {
  process.stdout.write(`배포 대기 ${WAIT_MS / 1000}초...\n`);
  await new Promise((r) => setTimeout(r, WAIT_MS));
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(4000);

const csvRowsFor = async (query) => {
  await page.getByLabel("분석 질의").fill(query);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(2600);
  const screenRows = (await page.locator(".rank-row").allTextContents()).length;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("export-csv").click(),
  ]);
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString("utf8");
  const body = text.trim().split("\n").filter((line) => /^\d/.test(line.trim()));
  return { screenRows, csvRows: body.length };
};

// [질의, 화면과 파일이 같아야 하는가, 기대 파일 행수(있으면), 설명]
const CASES = [
  ["상위 10% 소득 지역", 31, "비율: 화면 31 = 파일 31"],
  ["소득 400만원 이상인 동", null, "값 조건: 화면과 파일이 같다"],
  ["카드매출 상위 5곳만", 5, "개수: 화면 5 = 파일 5"],
  ["총인구 많은 시군구", 22, "시군구 22개 전부"],
];

let pass = 0;
for (const [q, expected, why] of CASES) {
  const { screenRows, csvRows } = await csvRowsFor(q);
  const ok = expected === null ? screenRows === csvRows : csvRows === expected && screenRows === expected;
  if (ok) pass += 1;
  console.log(`${ok ? "✓" : "✗"} [${why}] ${q} — 화면 ${screenRows}행 · CSV ${csvRows}행`);
}

// 조건 없는 질의는 파일이 화면보다 많아야 한다(페이징은 파일에 반영하지 않는다)
const plain = await csvRowsFor("생활인구 많은 동");
const plainOk = plain.csvRows > plain.screenRows;
if (plainOk) pass += 1;
console.log(`${plainOk ? "✓" : "✗"} [조건 없으면 파일이 더 많다] 생활인구 많은 동 — 화면 ${plain.screenRows}행 · CSV ${plain.csvRows}행`);

console.log(`\n통과 ${pass}/${CASES.length + 1} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === CASES.length + 1 && errors.length === 0 ? 0 : 1);
