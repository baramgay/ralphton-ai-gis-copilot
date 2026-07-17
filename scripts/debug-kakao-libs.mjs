import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const hits = [];
page.on("response", (r) => {
  const u = r.url();
  if (/kakao|daumcdn|mapjsapi/i.test(u)) hits.push(`${r.status()} ${u}`);
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (/kakao|daumcdn|mapjsapi/i.test(u)) hits.push(`FAIL ${r.failure()?.errorText} ${u}`);
});
page.on("console", (m) => {
  if (m.type() === "error") hits.push(`CONSOLE ${m.text()}`);
});
page.on("pageerror", (e) => hits.push(`PAGEERR ${e.message}`));

await page.goto("https://ralphton-ai-gis-copilot.vercel.app/", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(16_000);
const state = await page.evaluate(() => ({
  LatLng: typeof window.kakao?.maps?.LatLng,
  Map: typeof window.kakao?.maps?.Map,
  load: typeof window.kakao?.maps?.load,
  MarkerClusterer: typeof window.kakao?.maps?.MarkerClusterer,
  services: typeof window.kakao?.maps?.services,
  readyState: window.kakao?.maps?.readyState,
  fail: document.body.innerText.includes("연결 실패"),
  engine: document.querySelector("[data-map-engine]")?.getAttribute("data-map-engine"),
}));
console.log("STATE", JSON.stringify(state, null, 2));
console.log("HITS\n" + hits.join("\n"));
await browser.close();
