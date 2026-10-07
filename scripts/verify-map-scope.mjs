import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.UX_VERIFY_URL ?? 'https://gnbc.site';
const boundary = JSON.parse(await readFile('public/data/administrative-dong-20260701.geojson', 'utf8'));
const polygonCount = (features) => features.reduce((count, feature) => count + (feature.geometry.type === 'Polygon' ? 1 : feature.geometry.coordinates.length), 0);
const fullCount = polygonCount(boundary.features);
const scopedCount = polygonCount(boundary.features.filter((feature) => feature.properties.adm_nm.includes('양산시')));
const districtBoundary = JSON.parse(await readFile('public/data/administrative-sgg-20260701.geojson', 'utf8'));
const districtCount = polygonCount(districtBoundary.features);
await mkdir('test-results/map-scope', { recursive: true });
const browser = await chromium.launch();
const reports = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/api/usage/events', (route) => route.fulfill({ status: 200, body: '{"ok":true}' }));
    await context.addInitScript(() => localStorage.setItem('ralphton-onboard-v1', '1'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByTestId('copilot-shell').waitFor({ timeout: 60000 });
    const health = await page.evaluate(async () => (await (await fetch('/api/health', { cache: 'no-store' })).json()).build.commitSha);
    if (process.env.EXPECTED_SHA) assert.equal(health, process.env.EXPECTED_SHA);
    const map = page.locator('[data-map-engine="kakao"]');
    await page.waitForFunction((count) => document.querySelectorAll('[data-map-engine="kakao"] svg path').length === count, fullCount);
    const scaleKm = async () => map.evaluate((el) => {
      const match = el.textContent.match(/(\d+(?:\.\d+)?)\s*(km|m)/);
      return match ? Number(match[1]) * (match[2] === 'm' ? 0.001 : 1) : null;
    });
    const before = await scaleKm();
    await page.getByLabel('분석 질의').fill('양산시 유입인구 많은 읍면동');
    await page.getByRole('button', { name: '질의 실행', exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-map-engine="kakao"] svg path').length === count, scopedCount);
    await page.waitForFunction(() => document.querySelector('.map-context-badge')?.textContent.includes('양산시'));
    if (width < 1200) {
      const results = page.getByTestId('workspace-results-toggle');
      if (await results.getAttribute('aria-pressed') === 'true') await results.click();
    }
    await page.waitForFunction(() => {
      const tiles = [...document.querySelectorAll('[data-map-engine="kakao"] img')].filter((img) => img.width >= 128);
      return tiles.length > 0 && tiles.every((img) => img.complete && img.naturalWidth >= 128);
    });
    await page.waitForTimeout(500);
    const after = await scaleKm();
    assert(before > after && after > 0, JSON.stringify({ width, before, after }));
    await page.screenshot({ path: `test-results/map-scope/${width}-yangsan.png` });
    await page.getByLabel('분석 질의').fill('경상남도 유입인구 많은 읍면동');
    await page.getByRole('button', { name: '질의 실행', exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-map-engine="kakao"] svg path').length === count, fullCount);
    await page.waitForFunction(() => document.querySelector('.map-context-badge')?.textContent.includes('경상남도 전역'));
    await page.waitForTimeout(500);
    const restored = await scaleKm();
    assert(restored > after, JSON.stringify({ width, after, restored }));
    await page.getByLabel('분석 질의').fill('경상남도 유입인구 많은 시군구');
    await page.getByRole('button', { name: '질의 실행', exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-map-engine="kakao"] svg path').length === count, districtCount);
    await page.getByTestId('query-notice').filter({ hasText: '분석 완료' }).waitFor();
    const shapeIds = () => map.locator('svg path').evaluateAll((nodes) => nodes.map((node) => node.id));
    const idsBeforeTyping = await shapeIds();
    await page.getByLabel('분석 질의').pressSequentially(' abc', { delay: 100 });
    const idsAfterTyping = await shapeIds();
    const replacedOnTyping = idsBeforeTyping.filter((id) => !idsAfterTyping.includes(id)).length;
    assert.equal(replacedOnTyping, 0, JSON.stringify({ width, districtCount, replacedOnTyping }));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    reports.push({ width, fullCount, scopedCount, beforeKm: before, scopedKm: after, restoredKm: restored, districtCount, replacedOnTyping, health, errors });
    await context.close();
  }
  console.log(JSON.stringify({ base, reports, failures: 0 }));
} finally {
  await browser.close();
}
