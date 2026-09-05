/*
 * 이름과 용어가 **배포본 화면에** 실제로 나오는지 본다.
 *
 * 용어 정리는 코드에서 끝나지 않는다. 라벨은 컴포넌트에, 뜻은 용어집 모듈에, 설명은
 * 메타데이터에 흩어져 있어서 한 군데만 고치면 화면에서 두 이름이 공존한다. 실제로
 * 「의료취약지수」와 「의료 접근성 취약지수」가 한동안 같이 있었다.
 *
 * 그래서 배포본에서 **옛 이름이 없고 새 이름이 있는지**를 함께 본다. 새 이름만 확인하면
 * 옛 이름이 다른 자리에 남아 있어도 초록이 된다.
 *
 * 실행: node scripts/verify-terms-prod.mjs [URL] (종료 코드로 판정)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "https://ralphton-ai-gis-copilot.vercel.app/";
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  OK  " : "  !!  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByTestId("copilot-shell").waitFor({ timeout: 60_000 });

check((await page.title()).includes("누리맵"), "문서 제목이 누리맵", await page.title());
check(
  (await page.getByRole("heading", { name: /누리맵/ }).count()) > 0,
  "상단바에 제품 이름이 있다",
);

try {
  await page.getByTestId("onboard-card").waitFor({ timeout: 8_000 });
  await page.locator('[data-testid="onboard-card"] button').last().click();
} catch {
  // 안내를 이미 본 프로필이면 카드가 없다. 정상이다.
}

const shell = await page.getByTestId("copilot-shell").innerText();
check(shell.includes("의료 접근성"), "빠른 분석이 새 이름으로 나온다");
check(
  shell.includes("공급·거리·고령수요 합성"),
  "이름만으로 뜻이 안 서는 지표는 부제가 산식을 말한다",
);
check(!/의료취약지수/.test(shell), "옛 이름(의료취약지수)이 화면에 남아 있지 않다");
check(!/구 비교/.test(shell), "옛 이름(구 비교)이 남아 있지 않다");

/*
 * 용어집은 「의료취약지역이 뭐냐」는 물음에서 나왔다. 그 물음이 화면에서 답이 되는지를
 * 본다 — 항목이 있는지가 아니라 **뜻이 실려 있는지**.
 */
/*
 * 좌 패널이 접혀 있으면 탭 자체가 화면에 없다. 「조작」으로 먼저 연다 — 탭을 못 찾는 것과
 * 용어집이 없는 것은 다른 일인데, 그냥 기다리면 둘이 같은 실패로 보인다.
 */
const useTab = page.getByRole("tab", { name: "이용" });
if ((await useTab.count()) === 0 || !(await useTab.first().isVisible())) {
  await page.getByRole("button", { name: "조작" }).click();
}
await useTab.first().click();
const glossary = page.getByTestId("glossary");
await glossary.waitFor({ timeout: 10_000 });
const groups = glossary.locator("details");
check((await groups.count()) === 4, "용어를 네 갈래로 묶는다", `${await groups.count()}갈래`);

for (const name of ["자료", "공간 단위", "분석 방법", "지표 읽기"]) {
  await glossary.locator("summary", { hasText: name }).click();
}
const glossaryText = await glossary.innerText();
for (const [term, phrase] of [
  ["의료 접근성 취약지수", "0~100으로 합성한 값"],
  ["생활인구", "주민등록인구와 다릅니다"],
  ["독립 관측", "복제된 경우 1곳으로"],
  ["자료 없음", "0과 다릅니다"],
]) {
  check(
    glossaryText.includes(term) && glossaryText.includes(phrase.slice(0, 8)),
    `용어집이 「${term}」의 뜻을 말한다`,
  );
}
check(glossaryText.includes("⚠"), "틀리기 쉬운 자리를 함께 적는다");

await context.close();
await browser.close();
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
