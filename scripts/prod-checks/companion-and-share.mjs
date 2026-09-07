/*
 * 두 갈래를 본다 — 라우팅이 맞은 **뒤에** 틀어지던 자리들이다.
 *
 * 1) 동반 지표가 목록 줄과 내려받은 파일에 실리는가. 도구는 두 번째 지표를 붙이고 산식
 *    각주는 "함께 보세요"라 말하는데, 행의 note가 첫 지표만 담아 클릭해야 나오는 상세
 *    카드에만 있었다. 이 note 한 칸을 목록·CSV·HWP·리포트·슬라이드가 함께 읽는다.
 *
 * 2) 공유 링크를 열었을 때 질문의 조건이 살아 있는가. `tool`만 재생하면 시군구 단위·
 *    "상위 10%"·값 조건이 조용히 빠진다 — 조건 없이 답이 나오는 것이 가장 나쁘다.
 */
import { chromium } from "@playwright/test";

const URL = "https://gnbc.site";
const WAIT_MS = Number(process.env.WAIT_MS ?? 170_000);
if (WAIT_MS > 0) {
  process.stdout.write(`배포 대기 ${WAIT_MS / 1000}초...\n`);
  await new Promise((r) => setTimeout(r, WAIT_MS));
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const open = async (search = "") => {
  await page.goto(`${URL}${search}`);
  await page.getByRole("heading", { name: /경남 AI GIS/i }).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
  await page.waitForTimeout(4000);
};

const ask = async (query) => {
  await page.getByLabel("분석 질의").fill(query);
  await page.getByRole("button", { name: "질의 실행" }).click();
  await page.waitForTimeout(2800);
};

await open();

let pass = 0;
let total = 0;

/* ── 1. 동반 지표 ─────────────────────────────────────────────── */
// [질의, 첫 줄 note에 있어야 할 말, 왜]
const COMPANIONS = [
  ["세대수 많은 동", /세대당/, "세대 수는 절대량이라 세대당 인구를 같이 봐야 한다"],
  ["고령비율 상승하는 동", /현재|수준|고령/, "변화 %p만으로는 어디서 출발했는지 모른다"],
  ["사망 많은 동", /1만|만 명/, "절대 사망 수는 인구 규모에 끌려간다"],
];

for (const [query, want, why] of COMPANIONS) {
  total += 1;
  await ask(query);
  const note = (await page.locator(".rank-note").first().textContent({ timeout: 1500 }).catch(() => null)) ?? "";
  const ok = want.test(note);
  if (ok) pass += 1;
  console.log(`${ok ? "✓" : "✗"} [동반 지표 · ${why}] ${query} — note "${note.trim() || "(없음)"}"`);
}

// 파일에도 실리는가. 화면 note와 CSV 비고가 같은 칸이라는 것을 실제 다운로드로 확인한다.
total += 1;
await ask("세대수 많은 동");
const screenNote = ((await page.locator(".rank-note").first().textContent()) ?? "").trim();
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 30_000 }),
  page.getByTestId("export-csv").click(),
]);
let csv = "";
for await (const chunk of await download.createReadStream()) csv += chunk.toString("utf8");
const csvHasCompanion = /세대당/.test(csv);
if (csvHasCompanion) pass += 1;
console.log(
  `${csvHasCompanion ? "✓" : "✗"} [파일에도 실린다] 세대수 많은 동 — 화면 note "${screenNote}" · CSV 세대당 ${csvHasCompanion ? "있음" : "없음"}`,
);

/* ── 2. 공유 링크 복원 ─────────────────────────────────────────── */
// [공유 URL의 q, 복원된 화면이 만족해야 할 조건, 왜]
const SHARES = [
  {
    q: "총인구 많은 시군구",
    tool: "rankPopulation",
    why: "시군구 단위가 살아 있는가",
    check: async () => {
      const notice = (await page.getByTestId("query-notice").textContent({ timeout: 1500 }).catch(() => "")) ?? "";
      const rows = await page.locator(".rank-row").count();
      return { ok: /시군구/.test(notice) && !/행정동/.test(notice) && rows > 20, detail: `${rows}행 · ${notice.trim()}` };
    },
  },
  {
    q: "상위 10% 소득 지역",
    tool: "rankIncome",
    why: "비율 조건이 살아 있는가",
    check: async () => {
      const rows = await page.locator(".rank-row").count();
      // 305개 읍면동의 10%는 31개다. 조건이 빠지면 페이지 크기(24)나 전체가 나온다.
      return { ok: rows > 24 && rows < 60, detail: `${rows}행` };
    },
  },
];

for (const share of SHARES) {
  total += 1;
  await open(`?tool=${share.tool}&q=${encodeURIComponent(share.q)}`);
  await page.waitForTimeout(3200);
  const { ok, detail } = await share.check();
  if (ok) pass += 1;
  console.log(`${ok ? "✓" : "✗"} [공유 복원 · ${share.why}] "${share.q}" — ${detail}`);
}

/* ── 3. 데이터 라벨이 사실을 말하는가 ───────────────────────────── */
/*
 * prod는 `mode: "live"`인데 인구·세대는 기준 스냅샷(합성값)이다 — 갱신되는 것은 HIRA
 * 시설뿐이다. 배지가 그냥 "실데이터"라고 적혀 있으면 합성 인구가 보고서에 실린다.
 * 스냅샷 각주와 화면 글자가 같은 말을 하는지 본다.
 */
total += 1;
await open();
const snap = await (await fetch(`${URL}/api/data/snapshot`)).json();
const notesSaySynthetic = (snap.sourceNotes ?? []).some((n) => /합성값|기준 스냅샷을 유지/.test(n));
const badge = ((await page.locator(".ui-status").first().textContent().catch(() => "")) ?? "").trim();
const labelOk = notesSaySynthetic ? badge === "시설 실데이터" : badge === "실데이터" || badge === "시연";
if (labelOk) pass += 1;
console.log(
  `${labelOk ? "✓" : "✗"} [라벨이 사실을 말한다] mode=${snap.mode} · 각주는 ${notesSaySynthetic ? "합성 인구" : "실인구"} · 배지 "${badge}"`,
);

/* ── 4. 시군구에서 프로파일이 말없이 사라지지 않는가 ──────────────── */
total += 1;
await ask("총인구 많은 시군구");
await page.locator(".rank-row").first().click().catch(() => {});
await page.waitForTimeout(1200);
const profileNote = await page
  .getByTestId("region-profile-unavailable")
  .textContent({ timeout: 1500 })
  .catch(() => null);
const hasProfile = (await page.getByTestId("region-profile").count()) > 0;
// 둘 중 하나는 있어야 한다 — 프로파일이 뜨거나, 왜 없는지 밝히거나.
const silenceOk = hasProfile || Boolean(profileNote);
if (silenceOk) pass += 1;
console.log(
  `${silenceOk ? "✓" : "✗"} [시군구 프로파일이 말없이 사라지지 않는다] ${hasProfile ? "패널 있음" : `안내 "${(profileNote ?? "(없음)").trim()}"`}`,
);

console.log(`\n통과 ${pass}/${total} · JS 에러 ${errors.length}건`);
await browser.close();
process.exit(pass === total && errors.length === 0 ? 0 : 1);
