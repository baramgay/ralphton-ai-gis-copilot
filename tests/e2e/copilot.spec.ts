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
async function openSheet(page: Page, name: "분석 설정" | "결과") {
  const toggle = name === "결과" ? page.getByTestId("workspace-results-toggle") : page.getByRole("button", { name, exact: true });
  if (!(await toggle.isVisible().catch(() => false))) return;

  const side = name === "분석 설정" ? "left" : "right";
  const panel = page.locator(`.copilot-panel-${side}`);

  const narrow = await page.evaluate(() => window.matchMedia("(max-width: 1199px)").matches);
  if (narrow) {
    if (await panel.evaluate((el) => el.classList.contains("sheet-open"))) return;
    await toggle.click();
    await expect(panel).toHaveClass(/sheet-open/);
    return;
  }

  if (await panel.evaluate((el) => !el.classList.contains("is-collapsed"))) return;
  await toggle.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
}

async function selectDataset(page: Page, name: string | RegExp) {
  await openSheet(page, "분석 설정");
  await page.getByRole("button", { name: "자료 변경" }).click();
  await page.getByRole("button", { name: "전체 자료 보기" }).click();
  await page.getByRole("group", { name: "자료 선택 목록" }).getByRole("button", { name }).click();
}

test.describe("AI GIS Copilot core journey", () => {
  test("양산 지역 분석은 지도 경계를 좁히고 전체 분석으로 복원한다", async ({ page }) => {
    await page.route("**/v2/maps/sdk.js**", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    const map = page.getByTestId("demo-map");
    await expect(map).toBeVisible();
    const paths = map.locator("path[role=button]");
    const fullCount = await paths.count();
    await page.getByLabel("분석 질의").fill("양산시 유입인구 많은 읍면동");
    await page.getByRole("button", { name: "질의 실행", exact: true }).click();
    await expect.poll(() => paths.count()).toBeLessThan(fullCount);
    await expect.poll(() => paths.evaluateAll((nodes) => nodes.length > 0 && nodes.every((node) => node.getAttribute("aria-label")?.includes("양산시")))).toBe(true);
    await expect(page.locator(".map-context-badge")).toContainText("양산시");
    const fitted = await paths.evaluateAll((nodes) => {
      const boxes = nodes.map((node) => (node as SVGGraphicsElement).getBBox());
      return Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x));
    });
    expect(fitted).toBeGreaterThan(300);
    await page.getByLabel("분석 질의").fill("경상남도 유입인구 많은 읍면동");
    await page.getByRole("button", { name: "질의 실행", exact: true }).click();
    await expect(paths).toHaveCount(fullCount);
    await expect(page.locator(".map-context-badge")).toContainText("경상남도 전역");
  });

  test("경남 지역 정체성과 추천 질문이 실제 김해 분석으로 이어진다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("note", { name: "분석 대상 지역: 경상남도" })).toBeVisible();
    await page.getByRole("button", { name: "김해시 생활인구 많은 동", exact: true }).click();
    await expect(page.getByLabel("분석 질의")).toHaveValue("김해시 생활인구 많은 동");
    await page.getByRole("button", { name: "질의 실행", exact: true }).click();
    await openSheet(page, "분석 설정");
    await expect(page.getByTestId("analysis-scope")).toContainText("김해시", { timeout: 30_000 });
    await openSheet(page, "결과");
    await expect(page.getByTestId("one-line-conclusion")).toContainText("김해시");
  });

  test("자료 선택 모달의 단축키와 Escape는 배경 분석 패널을 닫지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await openSheet(page, "분석 설정");
    const sidebar = page.locator(".copilot-panel-left");
    const trigger = page.getByRole("button", { name: "자료 변경", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "자료 선택", exact: true });
    await expect(dialog).toBeVisible();

    // An editable search field would already suppress shortcuts; test a catalog button.
    const close = dialog.getByRole("button", { name: "자료 선택 닫기", exact: true });
    await close.focus();
    await page.keyboard.press("[");
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(sidebar).toHaveClass(/sheet-open/);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(sidebar).toHaveClass(/sheet-open/);
    await expect(sidebar).toHaveJSProperty("inert", false);
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return target === button || button.contains(target);
    })).toBe(true);
  });

  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await openSheet(page, "결과");
    await expect(page.getByTestId("analysis-empty-state")).toBeVisible();
    await expect(page.getByTestId("interpretation-card")).toHaveCount(0);
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await openSheet(page, "분석 설정");
    await selectDataset(page, /^의료기관/);
    await page.locator(".analysis-medical-tools > summary").click();
    await page.getByTestId("quick-elderly").click();
    await openSheet(page, "결과");
    await page.getByRole("tab", { name: "분석 근거", exact: true }).click();
    await expect(page.getByTestId("interpretation-card")).toBeVisible();

    await openSheet(page, "분석 설정");
    await page.getByTestId("quick-radius").click();
    await openSheet(page, "결과");
    await expect(page.getByTestId("interpretation-card")).toContainText(
      /기준월|해석|반경|접근|의료/,
    );

    await openSheet(page, "분석 설정");
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

    await page.getByRole("tab", { name: /^분석$/ }).click();
    await page.getByText("화면·접근성 설정").click();
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
    await openSheet(page, "분석 설정");

    await page.getByRole("button", { name: "자료 변경" }).click();
    await page.getByRole("button", { name: "전체 자료 보기" }).click();
    const labels = await page.locator(".dataset-card-label").evaluateAll((nodes) => nodes.map((node) => ({
      label: node.textContent,
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(node).lineHeight),
      overflow: node.scrollWidth > node.clientWidth,
    })));
    expect(labels).toHaveLength(23);
    expect(labels.filter(item => item.height > item.lineHeight * 2 + 1 || item.overflow)).toEqual([]);

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

    await page.getByRole("tab", { name: "선택 지역", exact: true }).click();
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
    // 새 분석은 결과 탭을 순위로 초기화한다. 완료 후 근거로 이동한다.
    await expect(page.getByTestId("query-notice")).toContainText("분석 완료", { timeout: 30_000 });
    await page.getByRole("tab", { name: "분석 근거", exact: true }).click();
    await expect(page.getByTestId("interpretation-card")).toBeVisible({ timeout: 30_000 });
  });

  test("지표를 바꾸면 지도 위 한 줄이 따라 바뀐다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "바로 시작" }).click().catch(() => {});
    await openSheet(page, "분석 설정");

    const chip = page.locator(".map-chip-topleft");
    await expect(chip).toContainText("시군구 경계");

    await selectDataset(page, /^생활인구/);
    await expect(chip).toContainText("생활인구");

    await selectDataset(page, /^인구/);
    await page.getByTestId("metric-picker").getByRole("button", { name: /총인구/ }).click();
    await expect(chip).toContainText("인구");
    await expect(chip).toContainText("총인구");

    await page.getByTestId("metric-picker").getByRole("button", { name: /세대수/ }).click();
    await expect(chip).toContainText("세대수");
  });
});


test("폰 가로에서 분석 후 결과 탭과 순위를 스크롤로 읽을 수 있다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => localStorage.setItem("ralphton-onboard-v1", "1"));
  await page.goto("/");
  await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("분석 질의").fill("생활인구 많은 동");
  await page.getByRole("button", { name: "질의 실행", exact: true }).click();
  await expect(page.getByTestId("one-line-conclusion")).toContainText("생활인구", { timeout: 30_000 });
  await openSheet(page, "결과");
  await page.getByRole("slider", { name: "결과 패널 높이 조절" }).focus();
  await page.keyboard.press("End");

  const reachable = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > innerHeight) return false;
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return target === element || element.contains(target);
  });
  const panel = page.getByTestId("result-panel");
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  // overflow:hidden도 프로그램으로는 스크롤되므로 실제 사용자 입력으로 확인한다.
  await page.mouse.wheel(0, 120);
  const evidence = page.getByRole("tab", { name: "분석 근거", exact: true });
  await expect.poll(() => reachable(evidence)).toBe(true);
  await evidence.click();
  await expect(evidence).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "순위", exact: true }).click();
  const firstRow = panel.locator(".rank-row").first();
  await firstRow.scrollIntoViewIfNeeded();
  await expect.poll(() => reachable(firstRow)).toBe(true);
  await firstRow.click();
  await testInfo.attach("phone-landscape-results", { body: await page.screenshot(), contentType: "image/png" });
});

test("closed panels do not receive keyboard focus and comparison shares restore the executed pair", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ralphton-onboard-v1", "1"));
  await page.goto("/");
  await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
  const narrow = await page.evaluate(() => matchMedia("(max-width: 1199px)").matches);
  if (narrow) {
    await expect(page.locator("#left-panel")).toHaveAttribute("inert", "");
    await expect(page.getByTestId("result-panel")).toHaveAttribute("inert", "");
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("aside[inert]")))).toBe(false);
    }
  }
  await page.getByRole("button", { name: "지역 비교", exact: true }).click();
  await openSheet(page, "결과");
  await page.getByLabel("비교할 지역 A").selectOption({ label: "진주시" });
  await page.getByLabel("비교할 지역 B").selectOption({ label: "거제시" });
  await page.getByRole("textbox", { name: "분석 질의" }).fill("실행하지 않은 질문");
  await openSheet(page, "결과");
  await page.getByTestId("export-share").click();
  const intent = JSON.parse(new URL(page.url()).searchParams.get("intent")!);
  expect(intent.filters.compare).toEqual(["진주시", "거제시"]);
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await page.reload();
  await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
  await openSheet(page, "결과");
  await expect(page.getByTestId("result-panel")).toContainText("진주시 vs 거제시");
  await page.getByTestId("result-search").fill("없는지역검색");
  await expect(page.getByTestId("export-csv")).toHaveCount(0);
  await page.getByRole("button", { name: "검색 지우기" }).click();
  await expect(page.getByTestId("export-csv")).toBeVisible();
});
