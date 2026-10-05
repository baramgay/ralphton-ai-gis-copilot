import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.argv[2] ?? "https://gnbc.site";
const label = process.argv[3] ?? "current";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid report label");
const browser = await chromium.launch();
const samples = [];
const queries = [
  ["생활인구 많은 동", /총생활인구 순위/],
  ["카드매출 높은 지역", /매출|카드/],
  ["평균소득 높은 동", /소득/],
  ["유입인구 많은 지역", /유입/],
];
const percentile = (values, proportion) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * proportion) - 1]);
};

try {
  for (const width of [390, 1440]) {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const started = performance.now();
      await page.goto(baseURL, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
      const readyMs = performance.now() - started;
      const timings = [];
      for (const [question, title] of queries) {
        await page.getByLabel("분석 질의").fill(question);
        const queryStarted = performance.now();
        await page.getByRole("button", { name: "질의 실행", exact: true }).click();
        const panel = page.getByTestId("result-panel");
        if (!(await panel.isVisible())) {
          await page.getByRole("button", { name: "결과", exact: true }).click();
        }
        await expect(panel.locator("header h2")).toHaveText(title, { timeout: 45_000 });
        await expect(page.locator(".rank-row").first()).toBeVisible({ timeout: 45_000 });
        timings.push({ question, elapsedMs: Math.round(performance.now() - queryStarted) });
      }
      expect(errors).toEqual([]);
      const resources = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        return {
          responseStartMs: Math.round(navigation.responseStart),
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
          resources: resources.length,
          sameOriginTransferBytes: resources.filter((resource) => new URL(resource.name).origin === location.origin).reduce((sum, resource) => sum + resource.transferSize, 0),
          cubeRequests: resources.filter((resource) => resource.name.includes("/data/layers/")).length,
        };
      });
      samples.push({ width, repeat: repeat + 1, readyMs: Math.round(readyMs), timings, ...resources });
      console.log(`PASS width=${width} repeat=${repeat + 1} ready=${Math.round(readyMs)}ms`);
      await context.close();
    }
  }
  const queryTimes = samples.flatMap((sample) => sample.timings.map((timing) => timing.elapsedMs));
  const report = {
    measuredAt: new Date().toISOString(), baseURL, label,
    environment: "Chromium fresh browser contexts, developer Windows host, normal network; timings include browser assertions and network",
    pageSamples: samples.length, querySamples: queryTimes.length,
    readyP50Ms: percentile(samples.map((sample) => sample.readyMs), 0.5),
    readyP95Ms: percentile(samples.map((sample) => sample.readyMs), 0.95),
    queryP50Ms: percentile(queryTimes, 0.5), queryP95Ms: percentile(queryTimes, 0.95),
    samples,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(`test-results/nurimap-browser-${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: undefined }));
} finally {
  await browser.close();
}
