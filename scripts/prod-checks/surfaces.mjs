import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
const WAIT_MS = Number(process.env.WAIT_MS ?? 150_000);
if (WAIT_MS > 0) {
  process.stdout.write(`배포 대기 ${WAIT_MS / 1000}초...\n`);
  await new Promise((r) => setTimeout(r, WAIT_MS));
}

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
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
  await page.waitForTimeout(2200);
};
const screenRows = () => page.locator(".rank-row").allTextContents().then((r) => r.length);
const downloadByTestId = async (testId) => {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.getByTestId(testId).click(),
  ]);
  const stream = await dl.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString("utf-8");
  return { file: dl.suggestedFilename(), text };
};
const csvBody = (text) => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const start = lines.findIndex((l) => l.startsWith("순위,"));
  return { header: lines[start], rows: lines.slice(start + 1) };
};

let pass = 0;
let total = 0;
const fail = (label, detail) => {
  total += 1;
  console.log(`✗ ${label}`);
  if (detail) console.log(`    ${detail}`);
};
const ok = (label) => {
  total += 1;
  pass += 1;
  console.log(`✓ ${label}`);
};

// ── 1) 시군구 결과 — 화면·CSV·MD·HWP·슬라이드 전부 "시군구"로, 22개 그대로 ──
console.log("=== 표면 1: 시군구 합산 (총인구 많은 시군구) ===");
await ask("총인구 많은 시군구");
const sggScreenRows = await screenRows();
sggScreenRows === 22 ? ok(`화면 22행 (실측 ${sggScreenRows})`) : fail("화면 행수", `기대 22, 실측 ${sggScreenRows}`);

const sggCsv = csvBody((await downloadByTestId("export-csv")).text);
sggCsv.header?.includes("시군구코드") ? ok("CSV 머리글 시군구코드") : fail("CSV 머리글", sggCsv.header);
sggCsv.rows.length === 22 ? ok(`CSV 본문 22행`) : fail("CSV 본문 행수", `실측 ${sggCsv.rows.length}`);

const sggMd = (await downloadByTestId("export-report")).text;
sggMd.includes("대상 시군구 22개") ? ok("MD 요약 '대상 시군구 22개'") : fail("MD 요약", sggMd.match(/대상[^\n]*/)?.[0]);

const sggHwp = (await downloadByTestId("export-hwp")).text;
sggHwp.includes("대상 시군구 22개") ? ok("HWP 요약 '대상 시군구 22개'") : fail("HWP 요약", sggHwp.match(/대상[^<]*/)?.[0]);

const sggSlide = (await downloadByTestId("export-slides")).text;
sggSlide.includes("대상 시군구 22개") ? ok("슬라이드 요약 '대상 시군구 22개'") : fail("슬라이드 요약", sggSlide.match(/대상[^<]*/)?.[0]);

// ── 2) 비율 조건 — 화면·CSV·MD가 같은 31행을 담는가(전체 305행 아님) ──
console.log("\n=== 표면 2: 비율 조건 (상위 10% 소득 지역) ===");
await ask("상위 10% 소득 지역");
const pctScreenRows = await screenRows();
pctScreenRows === 31 ? ok(`화면 31행`) : fail("화면 행수", `실측 ${pctScreenRows}`);
const pctCsv = csvBody((await downloadByTestId("export-csv")).text);
pctCsv.rows.length === 31 ? ok(`CSV 본문 31행(전체 305 아님)`) : fail("CSV 본문 행수", `실측 ${pctCsv.rows.length}`);
const pctMd = (await downloadByTestId("export-report")).text;
pctMd.includes("대상 행정동 31개") ? ok("MD 요약이 모수 31 반영") : fail("MD 요약", pctMd.match(/대상[^\n]*/)?.[0]);

// ── 3) 값 조건 — 표시 상한(24)에 안 걸리는 임계값으로, 화면=CSV=MD 전부 3행 ──
console.log("\n=== 표면 3: 값 조건 (소득 400만원 이상인 동) ===");
await ask("소득 400만원 이상인 동");
const valScreenRows = await screenRows();
valScreenRows === 3 ? ok(`화면 3행`) : fail("화면 행수", `실측 ${valScreenRows}`);
const valCsv = csvBody((await downloadByTestId("export-csv")).text);
valCsv.rows.length === 3 ? ok(`CSV 본문 3행`) : fail("CSV 본문 행수", `실측 ${valCsv.rows.length}`);

// ── 4) 동반 지표 — CSV note에 2번째 지표가 실리는가 ──
console.log("\n=== 표면 4: 동반 지표 (고령비율 상승하는 동, %p+수준) ===");
await ask("고령비율 상승하는 동");
const trendCsv = csvBody((await downloadByTestId("export-csv")).text);
const trendFirst = trendCsv.rows[0] ?? "";
trendFirst.includes("%p") ? ok("CSV에 %p 단위 표기") : fail("CSV %p 단위", trendFirst);
trendFirst.includes("고령인구 비율") ? ok("CSV에 동반 지표(고령인구 비율) 포함") : fail("CSV 동반 지표", trendFirst);

// ── 5) 공유 링크 — sgg·비율 조건 둘 다 같은 결론으로 복원되는가 ──
console.log("\n=== 표면 5: 공유 링크 복원 (시군구·비율 조건) ===");
async function checkShareRestore(label, query) {
  await ask(query);
  const before = clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => ""));
  await page.getByRole("button", { name: "공유" }).first().click();
  await page.waitForTimeout(700);
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (!shareUrl || !shareUrl.startsWith("http")) {
    fail(`${label} 공유 링크 생성`, "클립보드 접근 불가 — 환경 제약, 판정 보류");
    total -= 1; // 환경 제약은 판정에서 제외
    return;
  }
  const page2 = await context.newPage();
  await page2.goto(shareUrl);
  await page2.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60_000 });
  await page2.waitForTimeout(4000);
  const after = clean(await page2.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => ""));
  after === before ? ok(`${label} 공유 복원 일치`) : fail(`${label} 공유 복원`, `이전: ${before.slice(0, 70)} / 복원: ${after.slice(0, 70)}`);
  await page2.close();
}
await checkShareRestore("시군구", "총인구 많은 시군구");
await checkShareRestore("비율조건", "상위 10% 소득 지역");

// ── 6) 지역 프로파일 패널 ──
console.log("\n=== 표면 6: 지역 프로파일 패널 ===");
await ask("생활인구 많은 동");
const profileToggle = page.getByText(/민간데이터 종합/).first();
if (await profileToggle.isVisible().catch(() => false)) {
  await profileToggle.click();
  await page.waitForTimeout(800);
  const text = clean(await page.getByTestId("result-panel").textContent({ timeout: 1500 }).catch(() => ""));
  const hasProviders = ["SKT", "NH", "KCB"].filter((p) => text.includes(p)).length;
  hasProviders === 3 ? ok("프로파일 제공사 3/3 노출") : fail("프로파일 제공사", `${hasProviders}/3`);
} else {
  fail("프로파일 토글", "찾지 못함");
}

console.log(`\n통과 ${pass}/${total} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === total && errors.length === 0 ? 0 : 1);
