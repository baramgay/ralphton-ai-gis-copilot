import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
const URL = process.env.SHOT_URL ?? "https://gnbc.site";
// 세션마다 사라지는 임시 폴더에 박아 두면 다음 사람이 못 돌린다. OUT_DIR로 덮어쓴다.
const OUT = process.env.OUT_DIR ?? path.join(os.tmpdir(), "ralphton-prod-checks", "ui");
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.env.SHOT_TAG ?? "before";
const browser = await chromium.launch();

const start = async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 60000 });
  return page;
};

// 데스크톱
const p1 = await start(await browser.newContext({ viewport: { width: 1440, height: 900 } }));
await p1.screenshot({ path: `${OUT}/${TAG}-01-onboarding-1440.png` });
await p1.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await p1.waitForTimeout(3500);
await p1.screenshot({ path: `${OUT}/${TAG}-02-idle-1440.png` });
await p1.getByLabel("분석 질의").fill("생활인구 많은 동");
await p1.getByRole("button", { name: "질의 실행" }).click();
await p1.waitForTimeout(2500);
await p1.screenshot({ path: `${OUT}/${TAG}-03-result-1440.png` });
await p1.screenshot({ path: `${OUT}/${TAG}-04-resultfull-1440.png`, fullPage: true });

// 모바일
const p2 = await start(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
await p2.screenshot({ path: `${OUT}/${TAG}-05-onboarding-390.png` });
await p2.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await p2.waitForTimeout(3500);
await p2.screenshot({ path: `${OUT}/${TAG}-06-idle-390.png` });
await p2.getByLabel("분석 질의").fill("생활인구 많은 동");
await p2.screenshot({ path: `${OUT}/${TAG}-07-typed-390.png` });
const clicked = await p2
  .getByRole("button", { name: "질의 실행" })
  .click({ timeout: 5000 })
  .then(() => true)
  .catch(() => false);
console.log("모바일 질의 실행 버튼 클릭 가능:", clicked);
if (!clicked) await p2.getByLabel("분석 질의").press("Enter");
await p2.waitForTimeout(2500);
await p2.screenshot({ path: `${OUT}/${TAG}-08-result-390.png` });

// 태블릿
const p3 = await start(await browser.newContext({ viewport: { width: 820, height: 1180 } }));
await p3.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
await p3.waitForTimeout(3500);
await p3.screenshot({ path: `${OUT}/${TAG}-09-idle-820.png` });

console.log("done", TAG, URL);
await browser.close();
