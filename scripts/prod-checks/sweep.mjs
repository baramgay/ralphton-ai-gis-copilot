import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const URL = "https://ralphton-ai-gis-copilot.vercel.app";
/*
 * 산출물 경로는 한 사람의 임시 세션 폴더에 박혀 있었다. 그 폴더가 사라지자 스크립트가
 * 결과를 쓰다 죽었다 — 안전망이 자기가 만든 파일 자리 때문에 먼저 넘어졌다.
 * OUT_DIR로 덮어쓸 수 있게 두고, 없으면 OS 임시 폴더에 만든다.
 */
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "ralphton-prod-checks");
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, "prod-sweep.json");

/**
 * 질의 → 결과에 반드시 들어 있어야 할 것.
 * expect: 안내(queryNotice)나 방법론에 나와야 하는 정규식
 * kind: single | cross | trend  (안내 문구 형태를 가른다)
 */
const CASES = [
  // ── 단일 지표: 레이어별 대표 ──
  ["single", "생활인구 많은 동네", /총생활인구/],
  ["single", "생활인구 고령 비중 높은 곳", /생활인구 고령비중/],
  ["single", "유입인구 많은 지역", /유입인구/],
  ["single", "유출인구 상위", /유출인구/],
  ["single", "순유입 큰 지역", /순유입/],
  ["single", "주간인구 많은 동", /주간인구/],
  ["single", "야간인구 많은 동", /야간인구/],
  ["single", "주야간 인구 비율", /주야|주간 대비/],
  ["single", "카드매출 높은 지역", /카드매출/],
  ["single", "결제 건수 많은 동", /결제건수|건수/],
  ["single", "청년 소비 비중 높은 곳", /청년 소비/],
  ["single", "여성 소비 비중 높은 곳", /여성 소비/],
  ["single", "법인카드 비중 높은 동", /법인/],
  ["single", "야간 매출 높은 동", /야간 카드매출/],
  ["single", "야간 상권 발달한 동", /야간 소비비중|야간 상권/],
  ["single", "음식·숙박 비중 높은 동", /음식·숙박/],
  ["single", "소매업 비중 상위", /도소매/],
  ["single", "보건업 소비 비중 높은 곳", /보건·의료/],
  ["single", "학원 소비 많은 동", /교육/],
  ["single", "카페 상권 발달한 동", /카페/],
  ["single", "주유소 소비 비중 상위", /주유소/],
  ["single", "약국 비중 높은 곳", /병의원|약국/],
  ["single", "평균소득 높은 동", /평균소득/],
  ["single", "신용점수 높은 곳", /신용평점/],
  ["single", "1인 카드소비 상위", /1인 카드소비/],
  ["single", "연체율 높은 동", /연체율/],
  ["single", "부유층 밀집 지역", /하이엔드/],
  ["single", "전입 많은 동", /전입/],
  ["single", "전출 많은 지역", /전출/],
  ["single", "일자리 많은 동", /일자리/],
  ["single", "베드타운 성격 강한 동", /일자리 배율/],
  ["single", "관외 통근율 높은 동", /관외 통근/],
  ["single", "격자 소득 높은 블록", /격자 평균소득/],
  ["single", "격자 연체 높은 곳", /격자 연체율/],
  // ── 공공 ──
  ["public", "의료 취약 지역 순위", /의료취약/],
  ["public", "고령화율이 높은 곳", /고령/],
  ["public", "인구밀도가 높은 동", /밀도/],
  // ── 교차 ──
  ["cross", "생활인구는 많은데 카드매출은 적은 곳", /교차분석/],
  ["cross", "소득 높고 소비도 많은 동", /교차분석/],
  ["cross", "소득 낮고 의료 취약한 지역", /교차분석.*의료취약/],
  ["cross", "고령인구 많고 의료 취약한 곳", /교차분석/],
  ["cross", "생활인구 대비 카드매출", /교차분석/],
  // ── 추세 ──
  ["trend", "카드매출 늘어나는 동", /증가 추세/],
  ["trend", "생활인구 줄어드는 지역", /감소 추세/],
  ["trend", "소득 하락하는 곳", /감소 추세/],
  ["trend", "전입 늘어나는 지역", /증가 추세/],
  // ── 시군구 ──
  ["sgg", "시군구별 평균소득", /평균소득/],
  ["sgg", "시군구별 카페 비중", /카페/],
  ["sgg", "시군구별 생활인구", /총생활인구/],
  // ── 구어·변형 ──
  ["variant", "유동인구 많은데 어디야", /총생활인구/],
  ["variant", "장사 잘되는 곳", /카드매출/],
  ["variant", "돈 많이 쓰는 지역", /카드매출/],
  ["variant", "밤에 사람 많은 곳", /야간인구/],
  ["variant", "젊은 사람 소비 많은 데", /청년 소비/],
  ["variant", "부자 동네", /평균소득/],
  ["variant", "빚 많은 지역", /대출/],
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL);
await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await page.waitForTimeout(3000);

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const results = [];
let pass = 0;

for (const [kind, query, expect] of CASES) {
  await page.getByLabel("분석 질의").fill(query);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(1500);

  const notice = clean(await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => ""));
  const method = clean(await page.getByTestId("method-summary").textContent({ timeout: 1500 }).catch(() => ""));
  const conclusion = clean(await page.getByTestId("one-line-conclusion").textContent({ timeout: 1500 }).catch(() => ""))
    .replace("한 줄 결론복사", "");
  const rows = (await page.locator(".rank-row").allTextContents()).length;
  const haystack = `${notice} ${method} ${conclusion}`;

  const matched = expect.test(haystack);
  const stuck = /분석을 실행하는 중|다시 시도해 주세요/.test(notice);
  const ok = matched && rows > 0 && !stuck;
  if (ok) pass += 1;
  results.push({ kind, query, ok, matched, rows, stuck, notice, conclusion: conclusion.slice(0, 140) });
  if (!ok) {
    console.log(`✗ [${kind}] ${query}  (${rows}행${stuck ? " · 멈춤" : ""})`);
    console.log(`    기대 ${expect}`);
    console.log(`    안내 ${notice.slice(0, 100)}`);
    console.log(`    결론 ${conclusion.slice(0, 110)}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(`\n${pass}/${CASES.length} 통과 · JS 에러 ${errors.length}건`);
if (errors.length) console.log(errors.slice(0, 3).join("\n"));
await browser.close();
