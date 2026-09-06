import { expect, type Page, test } from "@playwright/test";

/**
 * 조작·결과 패널을 연다.
 *
 * 폭에 따라 여닫이 방식이 다르다. 좁은 화면에서는 바텀시트라 한 번에 하나만 열리고
 * (`sheet-open`), 넓은 화면에서는 접힘 상태다(`is-collapsed`). 질의창이 지도 위 히어로로
 * 올라가면서 넓은 화면에서도 왼쪽은 기본으로 접히므로, 두 경우를 다 다뤄야 한다.
 *
 * 이 배려가 없으면 닫힌 패널 안의 요소를 만지게 되는데, Playwright가 강제로 스크롤해
 * 좌표는 맞춰 놓고 정작 그 자리에는 다른 것이 있어 클릭이 가로채인다.
 */
async function openSheet(page: Page, name: "조작" | "결과") {
  const toggle = page.getByRole("button", { name, exact: true });
  if (!(await toggle.isVisible().catch(() => false))) return;

  const side = name === "조작" ? "left" : "right";
  const panel = page.locator(`.copilot-panel-${side}`);
  const isOpen = () =>
    panel.evaluate(
      (el) => !el.classList.contains("is-collapsed") || el.classList.contains("sheet-open"),
    );

  const narrow = await page.evaluate(() => window.matchMedia("(max-width: 900px)").matches);
  if (narrow) {
    if (await panel.evaluate((el) => el.classList.contains("sheet-open"))) return;
    await toggle.click({ force: true });
    await expect(panel).toHaveClass(/sheet-open/);
    return;
  }

  if (await isOpen()) return;
  await toggle.click({ force: true });
  await expect(panel).not.toHaveClass(/is-collapsed/);
}

test.describe("AI GIS Copilot core journey", () => {
  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await openSheet(page, "결과");
    await expect(page.getByTestId("interpretation-card")).toBeVisible();
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await openSheet(page, "조작");
    await page.getByRole("group", { name: "레이어 선택" }).getByRole("button", { name: /^의료기관/ }).click();
    await page.getByTestId("quick-elderly").click();
    await openSheet(page, "결과");
    await expect(page.getByTestId("interpretation-card")).toBeVisible();

    await openSheet(page, "조작");
    await page.getByTestId("quick-radius").click();
    await openSheet(page, "결과");
    await expect(page.getByTestId("interpretation-card")).toContainText(
      /기준월|해석|반경|접근|의료/,
    );

    await openSheet(page, "조작");
    await page.getByRole("tab", { name: "이용" }).click();
    await expect(page.getByRole("tab", { name: "이용" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("usage-guide")).toBeVisible();
    await expect(page.getByText("활용 가이드")).toBeVisible();

    await page.getByRole("tab", { name: "데이터" }).click();
    await expect(page.getByRole("tab", { name: "데이터" })).toHaveAttribute("aria-selected", "true");
    // 「무엇을 썼는가」는 결과만큼 중요하다 — 목록이 화면에 실제로 있어야 한다.
    await expect(page.getByTestId("data-inventory")).toBeVisible();
    await expect(page.getByTestId("data-mode-banner")).toBeVisible();
    await expect(page.getByTestId("data-mode-banner")).toContainText(/시연|실데이터/);

    await page.getByRole("tab", { name: "분석" }).click();
    await page.getByText("화면 설정").click();
    await expect(page.getByTestId("theme-dark")).toBeVisible();
    await expect(page.getByTestId("theme-system")).toBeVisible();

    await page.getByTestId("theme-dark").click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");
  });

  /*
   * 레이어 이름이 세로로 흘러내리던 결함.
   *
   * .layer-switcher가 flex:1 한 줄이라 칸을 균등 분할했다. NH처럼 한 기관에 5개가 몰리면
   * 300px 패널에서 한 칸이 54px이 되고, "카드소비"가 카/드/소/비 네 줄로 쪼개졌다.
   * DOM 검사로는 안 잡힌다 — 글자는 다 있었고 배치만 무너졌다. 실제 높이를 잰다.
   */
  test("레이어 이름이 세로로 쪼개지지 않는다", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
    await openSheet(page, "조작");

    const tall = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".layer-switcher-item")];
      const lineHeight = 18; // ui-body 한 줄의 대략치
      return items
        .map((el) => ({
          label: el.textContent?.trim() ?? "",
          height: el.getBoundingClientRect().height,
        }))
        // 한 줄짜리 알약은 패딩 포함 34px 안팎이다. 두 줄이면 이미 무너진 것이다.
        .filter((item) => item.height > lineHeight * 2 + 16);
    });

    expect(tall, `세로로 흐른 레이어: ${JSON.stringify(tall)}`).toEqual([]);
    expect(await page.locator(".layer-switcher-item").count()).toBeGreaterThan(10);
  });

  /*
   * 화면이 답과 같은 지역을 가리켜야 한다.
   *
   * 선택 지역은 "순위에 없을 때만" 옮겼는데, 읍면동은 어느 지표에서나 순위에 들어 있어
   * 한 번 선택된 지역이 분석을 바꿔도 계속 남았다. 그래서 "1위는 양산시 물금읍"이라는
   * 결론 옆에 `선택 278위`와 `거창군 북상면 민간데이터 종합`이 붙어 있었다(prod 실측).
   * 순위·결론·프로파일이 각각은 맞는데 서로 다른 곳을 말하고 있었다.
   */
  test("분석을 바꾸면 선택도 그 답을 따라간다", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});

    // 먼저 한 분석을 돌려 선택이 생기게 한 뒤, 다른 분석으로 바꾼다.
    await page.getByLabel("분석 질의").fill("의료 취약 지역");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await page.waitForTimeout(1500);

    await page.getByLabel("분석 질의").fill("생활인구 많은 동");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await expect(page.getByTestId("result-meta")).toContainText("선택 1위", { timeout: 30_000 });

    const topName = ((await page.locator(".rank-row .rank-name").first().textContent()) ?? "").trim();
    expect(topName.length).toBeGreaterThan(0);

    const profile = page.getByTestId("region-profile");
    if (await profile.isVisible().catch(() => false)) {
      // 프로파일이 가리키는 지역이 1위와 같아야 한다.
      await expect(profile).toContainText(topName.replace(/^경상남도\s*/, ""));
    }
  });

  test("runs natural language query path", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    // 질의창은 어느 패널에도 속하지 않는다. 패널을 열지 않아도 닿아야 한다.
    const input = page.getByLabel("분석 질의");
    await input.fill("창원 의료 취약");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await openSheet(page, "결과");
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("interpretation-card")).toBeVisible({ timeout: 30_000 });
  });

  test("지표를 바꾸면 지도 위 한 줄이 따라 바뀐다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
    await openSheet(page, "조작");

    const chip = page.locator(".map-chip-topleft");
    await expect(chip).toContainText("생활인구");

    await page.getByRole("group", { name: "레이어 선택" }).getByRole("button", { name: /^인구/ }).click();
    await page.getByTestId("metric-picker").getByRole("button", { name: /총인구/ }).click();
    await expect(chip).toContainText("인구");
    await expect(chip).toContainText("총인구");

    await page.getByTestId("picker-summary").click();
    await page.getByTestId("metric-picker").getByRole("button", { name: /세대수/ }).click();
    await expect(chip).toContainText("세대수");
  });
});
