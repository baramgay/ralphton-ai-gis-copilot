// FPS 실측 — Playwright + Chromium. Pixel 5급 배율(393×727, DSR 2.75).
// 실행: node docs/design/measure/fps.mjs
// 각 모드(glass / moving / solid)에서 6초간 rAF 프레임 간격을 모아
// 평균 FPS, p95 프레임 시간, 16.7ms 초과 비율을 낸다.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url = (mode) => pathToFileURL(resolve(here, "pan-harness.html")).href + `?mode=${mode}`;

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist"],
});
// 저사양 경로 재현: 소프트웨어 래스터라이저(실제 약한 모바일 GPU의 worst case 경로)
const browserSw = await chromium.launch({ headless: true, args: ["--disable-gpu"] });

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function run(browserInstance, label) {
  console.log(`\n[${label}] chromium ${browserInstance.version()}`);
  for (const mode of ["glass", "moving", "solid"]) {
    const ctx = await browserInstance.newContext({
      viewport: { width: 393, height: 727 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(url(mode));
    await page.waitForTimeout(1000); // 워밍업
    await page.evaluate(() => { window.__frames.length = 0; });
    await page.waitForTimeout(6000);
    /** @type {number[]} */
    const frames = await page.evaluate(() => window.__frames);
    await ctx.close();

    const n = frames.length;
    const total = frames.reduce((a, b) => a + b, 0);
    const avgFps = (n / (total / 1000)).toFixed(1);
    const p95 = pct(frames, 95).toFixed(1);
    const p99 = pct(frames, 99).toFixed(1);
    const over16 = ((frames.filter((f) => f > 16.7).length / n) * 100).toFixed(1);
    const over33 = ((frames.filter((f) => f > 33.3).length / n) * 100).toFixed(1);
    console.log(
      `mode=${mode.padEnd(6)} frames=${n} avg=${avgFps}fps p95=${p95}ms p99=${p99}ms >16.7ms=${over16}% >33ms=${over33}%`,
    );
  }
}

await run(browser, "GPU");
await run(browserSw, "software raster (--disable-gpu)");
await browser.close();
await browserSw.close();
