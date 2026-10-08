import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "https://gnbc.site/";
const output = "test-results/masan-context";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = { base, checkedAt: new Date().toISOString(), cases: [], errors };
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("copilot-shell").waitFor({ timeout: 90_000 });
  const onboard = page.getByTestId("onboard-card");
  if (await onboard.isVisible()) await onboard.locator("button").last().click();

  const run = async (query, metric, regions) => {
    await page.getByLabel("분석 질의").fill(query);
    await page.getByRole("button", { name: "질의 실행", exact: true }).click();
    await expect(page.getByTestId("result-panel")).toContainText(metric, { timeout: 60_000 });
    await expect(page.locator(".rank-row").first()).toBeVisible({ timeout: 60_000 });
    const scope = page.getByTestId("analysis-scope");
    for (const region of regions) await expect(scope).toContainText(region, { timeout: 60_000 });
    const rows = await page.locator(".rank-row").allTextContents();
    if (regions.length) for (const row of rows) {
      if (!regions.some((region) => row.includes(region))) throw new Error(`Out-of-scope row: ${row}`);
    }
    report.cases.push({ query, metric, scope: await scope.textContent(), rows });
    console.log(`PASS ${query}: ${rows.length} rows`);
  };

  await run("마산 카드매출 높은 지역", "카드매출", ["마산합포구", "마산회원구"]);
  await page.screenshot({ path: `${output}/masan-card-sales.png`, fullPage: true });
  await run("그중 생활인구 높은 곳", "생활인구", ["마산합포구", "마산회원구"]);
  await run("진주 카드매출 높은 지역", "카드매출", ["진주시"]);
  await run("카드매출 높은 지역", "카드매출", []);
  await expect(page.getByTestId("analysis-scope")).not.toContainText("마산합포구");
  await expect(page.getByTestId("analysis-scope")).not.toContainText("진주시");

  const rag = await page.evaluate(async () => {
    const response = await fetch("/api/rag/search", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "마산 카드매출 높은 지역", useRemoteEmbed: false }) });
    return { status: response.status, body: await response.json() };
  });
  expect(rag.status).toBe(200);
  expect(rag.body.citations.some((citation) => citation.id === "geography-group-마산")).toBe(true);
  report.rag = { status: rag.status, citations: rag.body.citations };
  expect(errors).toEqual([]);
} catch (error) {
  report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
