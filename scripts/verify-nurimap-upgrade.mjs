import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// Run against a local production server or a deployed URL. Artifacts stay in test-results.
const baseURL = process.argv[2] ?? "http://127.0.0.1:3110";
const output = path.resolve(process.argv[3] ?? "test-results/nurimap-upgrade");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

async function resultsVisible(page) {
  const panel = page.getByTestId("result-panel");
  if (await panel.getAttribute("inert") !== null) {
    await page.getByTestId("workspace-results-toggle").click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page, question, title) {
  await page.getByLabel("분석 질의").fill(question);
  await page.getByRole("button", { name: "질의 실행", exact: true }).click();
  const panel = await resultsVisible(page);
  await expect(panel.locator("header h2")).toHaveText(title, { timeout: 45_000 });
  await expect(page.getByRole("tab", { name: "순위", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".rank-row").first()).toBeVisible({ timeout: 45_000 });
  return panel;
}

async function verifyArtifacts(page, provider) {
  const heading = await page.getByTestId("result-panel").locator("header h2").innerText();
  const downloadPending = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const download = await downloadPending;
  const csv = await readFile(await download.path(), "utf8");
  const month = csv.match(/기준월,([^\r\n]+)/)?.[1];
  expect(month).toBeTruthy();
  expect(download.suggestedFilename()).toContain(month);
  expect(csv).toContain(provider);
  await page.getByRole("tab", { name: "분석 근거", exact: true }).click();
  await expect(page.getByTestId("interpretation-card")).toBeVisible();
  await expect(page.getByTestId("interpretation-card")).toContainText(month);
  await expect(page.getByTestId("result-panel").locator("header")).toContainText(month);
  const popupPending = page.waitForEvent("popup");
  await page.getByTestId("export-report").click();
  const report = await popupPending;
  await report.waitForLoadState("domcontentloaded");
  await expect(report.locator("body")).toContainText(month);
  await expect(report.locator("body")).toContainText(provider);
  await report.close();
  await page.getByRole("tab", { name: "순위", exact: true }).click();
  await page.getByTestId("export-share").click();
  const shareURL = page.url();
  expect(new URL(shareURL).searchParams.get("q")).toBeTruthy();
  await page.goto(shareURL, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("result-panel").locator("header h2")).toHaveText(heading, { timeout: 60_000 });
  await expect(page.getByTestId("interpretation-card")).toContainText(month);
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : undefined,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".map-status")).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator('[data-testid="demo-map"], .copilot-map [aria-label^="경남"][aria-label$="분석 지도"]').first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByLabel("분석 질의")).toBeVisible();
    await expect(page.getByTestId("selected-population-note")).toHaveCount(0);
    await expect(page.getByTestId("export-csv")).toHaveCount(0);
    const width = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
    expect(width.body).toBeLessThanOrEqual(width.viewport);
    await page.screenshot({ path: path.join(output, `initial-${viewport.width}.png`) });

    // This question is supplied by the welcome card, so it must execute with one click.
    await page.getByRole("button", { name: "생활인구 보기", exact: true }).click();
    await resultsVisible(page);
    await expect(page.getByTestId("result-panel").locator("header h2")).toHaveText(/총생활인구 순위/, { timeout: 45_000 });
    await expect(page.locator(".rank-row").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("tab", { name: "순위", exact: true })).toHaveAttribute("aria-selected", "true");
    const second = await page.locator(".rank-row").nth(1).boundingBox();
    expect(second).toBeTruthy();
    expect(second.y + second.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByTestId("interpretation-card")).not.toContainText("97,787.3점");
    const snapshot = await (await page.request.get(`${baseURL}/api/data/snapshot?mode=auto`)).json();
    if (snapshot.sourceNotes.some((note) => /합성|PRNG/.test(note))) {
      await expect(page.getByTestId("selected-population-note")).toContainText(/합성|시연/);
    } else {
      await expect(page.getByTestId("selected-population-note")).toHaveCount(0);
    }
    await expect(page.locator(".ui-toast")).toHaveCount(0, { timeout: 10_000 });
    await page.screenshot({ path: path.join(output, `analysis-${viewport.width}.png`) });

    if (viewport.width === 1440) {
      await verifyArtifacts(page, "SKT");
      await ask(page, "카드매출 높은 지역", /매출|카드/);
      await expect(page.getByTestId("interpretation-card")).toContainText("NH");
      await verifyArtifacts(page, "NH");
      await ask(page, "평균소득 높은 동", /소득/);
      await expect(page.getByTestId("interpretation-card")).toContainText("KCB");
      await verifyArtifacts(page, "KCB");
      await ask(page, "유입인구 많은 지역", /유입/);
      await expect(page.getByTestId("interpretation-card")).toContainText("SKT");
      await verifyArtifacts(page, "SKT");
      // Comparison is a direct workflow, and sharing preserves the pair rather than draft text.
      await page.getByRole("button", { name: "지역 비교", exact: true }).click();
      await resultsVisible(page);
      await page.getByLabel("비교할 지역 A").selectOption({ label: "진주시" });
      await page.getByLabel("비교할 지역 B").selectOption({ label: "거제시" });
      await page.getByLabel("분석 질의").fill("실행하지 않은 질문");
      await page.getByTestId("export-share").click();
      const shared = new URL(page.url());
      expect(JSON.parse(shared.searchParams.get("intent")).filters.compare).toEqual(["진주시", "거제시"]);
      expect(shared.searchParams.has("q")).toBe(false);
      await page.reload();
      await expect(page.getByTestId("result-panel").locator("header h2")).toContainText("진주시 vs 거제시", { timeout: 60_000 });
      await page.getByTestId("result-search").fill("없는지역검색");
      await expect(page.getByTestId("export-csv")).toHaveCount(0);
      await page.getByRole("button", { name: "검색 지우기", exact: true }).click();
      await expect(page.getByTestId("export-csv")).toBeVisible();
      // Tabs are keyboard operable while exports remain available outside each view.
      await page.getByRole("tab", { name: "순위", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "선택 지역", exact: true })).toBeFocused();
      await expect(page.getByRole("tabpanel", { name: "선택 지역", exact: true })).toBeVisible();
      await page.keyboard.press("End");
      await expect(page.getByRole("tab", { name: "분석 근거", exact: true })).toBeFocused();
      await expect(page.getByTestId("export-csv")).toBeVisible();
    }
    expect(errors).toEqual([]);
    results.push({ viewport, passed: true });
    console.log(`PASS ${viewport.width}×${viewport.height}`);
    await context.close();
  }
  console.log(JSON.stringify({ baseURL, results, screenshots: output }));
} finally {
  await browser.close();
}
