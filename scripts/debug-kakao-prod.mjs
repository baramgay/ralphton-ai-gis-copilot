import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`ERR: ${e.message}`));

await page.goto("https://ralphton-ai-gis-copilot.vercel.app/", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});

async function snap(t) {
  const text = await page.locator("body").innerText();
  const engine = await page
    .locator("[data-map-engine]")
    .first()
    .getAttribute("data-map-engine")
    .catch(() => null);
  const state = await page.evaluate(() => {
    const mapEl = document.querySelector("[data-map-engine]");
    const aria = document.querySelector('[aria-label*="지도"]');
    return {
      kakao: Boolean(window.kakao),
      LatLng: typeof window.kakao?.maps?.LatLng,
      Map: typeof window.kakao?.maps?.Map,
      engineAttr: mapEl?.getAttribute("data-map-engine") ?? null,
      mapChildren: mapEl?.children?.length ?? 0,
      ariaW: aria?.clientWidth ?? 0,
      ariaH: aria?.clientHeight ?? 0,
      failBanner: document.body.innerText.includes("Kakao 지도 연결 실패"),
      timeoutBanner: document.body.innerText.includes("로드 시간 초과"),
    };
  });
  console.log(
    JSON.stringify(
      {
        t,
        engine,
        hasFail: text.includes("Kakao 지도 연결 실패"),
        hasDemo: text.includes("DemoMap"),
        hasKakaoLabel: text.includes("Kakao Maps"),
        state,
      },
      null,
      2,
    ),
  );
}

await page.waitForTimeout(4000);
await snap(4);
await page.waitForTimeout(14000);
await snap(18);
await page.screenshot({ path: "logs/kakao-playwright.png" });
console.log(
  "relevant logs:",
  logs.filter((l) => /kakao|Kakao|CSP|eval|fail|Error|error/i.test(l)).slice(0, 40),
);
await browser.close();
