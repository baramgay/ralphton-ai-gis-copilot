/*
 * 첫 화면이 언제 보이는지를 잰다 — FCP 와 제목(h1)이 실제로 그려진 시각.
 *
 * ⚠️ 배포 직후 첫 측정은 콜드스타트다. 한 번은 없는 회귀를 6.4초로 보고했고, 데운 뒤에
 * 다시 재니 1.6~2.8초였다. 그래서 **버리는 방문**을 먼저 하고, 그다음 여러 번 재
 * 중앙값을 쓴다.
 *
 * 캐시는 매번 비운다(새 방문자 기준). 재사용 캐시로 재면 예산이 아니라 자기 캐시를
 * 재게 된다.
 *
 * 실행: node scripts/verify-perf-prod.mjs [URL] [반복수]
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://gnbc.site/";
const RUNS = Number(process.argv[3] ?? 5);

/* 예산은 이전 측정에서 온 값이다. 넘으면 붉게 간다. */
const BUDGET = { fcp: 400, h1: 450 };

const browser = await chromium.launch();

async function visit() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 60_000 });
  const h1 = Date.now() - started;
  const fcp = await page.evaluate(
    () => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
  );
  await context.close();
  return { fcp, h1 };
}

/* 버리는 방문 — 함수·캐시를 데운다. 이 값은 쓰지 않는다. */
const warm = await visit();
console.log(`데우기(버림): FCP ${warm.fcp?.toFixed(0) ?? "?"}ms · h1 ${warm.h1}ms`);

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await visit();
  runs.push(r);
  console.log(`  ${i + 1}회 FCP ${r.fcp?.toFixed(0) ?? "?"}ms · h1 ${r.h1}ms`);
}
await browser.close();

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fcp = median(runs.map((r) => r.fcp).filter((v) => v != null));
const h1 = median(runs.map((r) => r.h1));

console.log(`\n중앙값 — FCP ${fcp.toFixed(0)}ms (예산 ${BUDGET.fcp}) · h1 ${h1}ms (예산 ${BUDGET.h1})`);
const ok = fcp <= BUDGET.fcp && h1 <= BUDGET.h1;
console.log(ok ? "예산 안" : "예산 초과");
process.exit(ok ? 0 : 1);
