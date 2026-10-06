import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only acceptance: public snapshot, public boundaries and real UI only.
const base = process.argv[2] ?? 'https://gnbc.site';
const report = { base, checkedAt: new Date().toISOString(), cases: [] };
const output = 'test-results/region-facilities';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem('ralphton-onboard-v1', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function inGeometry(point, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(p => inRing(point, p[0]) && !p.slice(1).some(hole => inRing(point, hole)));
}
async function profileCase(name, params, expected, regionName, extra) {
  await page.goto(`${base}/?${new URLSearchParams(params)}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('copilot-shell').waitFor({ timeout: 60_000 });
  const results = page.getByTestId('workspace-results-toggle');
  if (await results.getAttribute('aria-pressed') !== 'true') await results.click();
  await page.getByRole('tab', { name: '선택 지역', exact: true }).click();
  const profile = page.locator('#result-view-region');
  await expect(profile).toContainText(regionName, { timeout: 30_000 });
  const label = profile.getByText('의료기관 · 심평원', { exact: true });
  await expect(label).toBeVisible();
  const value = label.locator('..').locator('p').last();
  await expect(value).toHaveText(String(expected), { timeout: 30_000 });
  await expect(page.locator('[data-map-engine="kakao"]')).toBeVisible({ timeout: 30_000 });
  if (extra) await extra();
  await page.screenshot({ path: `${output}/${name}.png` });
  report.cases.push({ name, expected, actual: Number(await value.innerText()), regionName });
  console.log(`OK ${name}: ${regionName} 전체 의료기관 ${expected}`);
}
try {
  const sr = await context.request.get(`${base}/api/data/snapshot`, { timeout: 60_000 });
  expect(sr.ok()).toBe(true);
  const snapshot = await sr.json();
  const br = await context.request.get(`${base}/data/administrative-dong-20260701.geojson`, { timeout: 60_000 });
  expect(br.ok()).toBe(true);
  const boundary = await br.json();
  const gaho = snapshot.regions.find(r => r.adm_nm === '경상남도 진주시 가호동');
  expect(gaho?.adm_cd2).toBe('4817074000');
  const feature = boundary.features.find(f => f.properties.adm_nm === gaho.adm_nm);
  expect(feature.properties.adm_cd2).toBe(gaho.adm_cd2);
  const facilities = snapshot.facilities;
  const scoped = facilities.filter(f => f.adm_cd2 === gaho.adm_cd2);
  const spatial = facilities.filter(f => inGeometry([f.lng, f.lat], feature.geometry));
  expect(scoped.length).toBeGreaterThan(0);
  expect(spatial.map(f => f.id).sort()).toEqual(scoped.map(f => f.id).sort());
  const districtCode = gaho.adm_cd2.slice(0, 5);
  const district = facilities.filter(f => f.adm_cd2.startsWith(districtCode));
  const clinics = scoped.filter(f => f.type === '의원');
  report.source = { total: facilities.length, gahoCode: gaho.adm_cd2, assigned: scoped.length, polygon: spatial.length, jinjuCode: districtCode, jinjuTotal: district.length, gahoClinics: clinics.length, publishedAt: sr.headers()['x-published-at'] ?? null };
  console.log('SOURCE', JSON.stringify(report.source));
  for (const [name, level, code, count, label] of [
    ['gaho-population', 'dong', gaho.adm_cd2, scoped.length, '가호동'],
    ['jinju-population', 'sgg', districtCode, district.length, '진주시'],
  ]) {
    await profileCase(name, { region: code, layer: JSON.stringify({ id: 'population', metricKey: 'pop_total', adminLevel: level, direction: 'desc', regions: [] }) }, count, label, async () => {
      await expect(page.getByTestId('map-view-chip')).toContainText('총인구');
      await expect(page.getByTestId('map-view-chip')).toContainText(level === 'dong' ? '행정동' : '시군구');
    });
  }
  await profileCase('gaho-clinic-filter', {
    region: gaho.adm_cd2,
    markers: 'selected',
    intent: JSON.stringify({ tool: 'filterFacilitiesByTypeAndHours', filters: { regions: ['진주시 가호동'], facilityTypes: ['의원'], limit: 20 } }),
  }, scoped.length, '가호동', async () => {
    await page.getByRole('tab', { name: '순위', exact: true }).click();
    const rows = page.locator('#result-view-rank .rank-row');
    await expect(rows).toHaveCount(clinics.length);
    const names = await rows.allTextContents();
    for (const clinic of clinics) expect(names.some(text => text.includes(clinic.name))).toBe(true);
    await page.getByRole('tab', { name: '선택 지역', exact: true }).click();
    report.filteredResultCount = clinics.length;
    console.log(`OK 유형 필터: 의원 ${clinics.length}곳, 지역 전체 통계 ${scoped.length}곳 유지`);
  });
  expect(errors).toEqual([]);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  report.pageErrors = errors;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
