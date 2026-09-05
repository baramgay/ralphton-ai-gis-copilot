import { expect, type Page, test } from "@playwright/test";

/**
 * 그 자리에 실제로 무엇이 있는지 묻는다.
 *
 * toBeVisible은 DOM에 있고 크기가 있으면 통과하므로, 다른 요소가 위를 덮고 있어도
 * 알아채지 못한다. 모바일에서 실제로 겪은 두 결함이 모두 그 틈으로 지나갔다.
 */
async function isReachable(page: Page, label: string): Promise<boolean> {
  return page.evaluate((text) => {
    const bar = document.querySelector(".map-float-dock");
    const btn = [...(bar?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent?.trim() === text,
    );
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) return false;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === btn || btn.contains(top);
  }, label);
}

/** 셀렉터로 집은 요소가 실제로 그 자리에서 눌리는지. */
async function selectorReachable(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((css) => {
    const el = document.querySelector(css);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.top < 0 || r.bottom > window.innerHeight) return false;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top) || el === top?.closest(css);
  }, selector);
}

test.describe("mobile sheet", () => {
  // 세로가 짧은 기기에서만 드러나는 겹침이 있어 727px로 본다(Pixel 5).
  test.use({ viewport: { width: 393, height: 727 } });

  test("shows mobile chrome and can open result sheet", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();

    await expect(page.locator(".sheet-handle").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "조작" })).toBeVisible();
    await expect(page.getByRole("button", { name: "결과" })).toBeVisible();

    await page.getByRole("button", { name: "결과" }).click({ force: true });
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("one-line-conclusion")).toBeVisible();
  });

  /*
   * 이 도구의 주기능은 자연어 질의다. 그런데 결과 시트가 첫 화면부터 열려 질의창을 덮어,
   * 모바일·태블릿에서 질문을 아예 할 수 없었다(Playwright가 `질의 실행` 버튼을 20회
   * 재시도 끝에 포기했다 — result-panel subtree intercepts pointer events).
   *
   * toBeVisible로는 못 잡는다. 버튼은 DOM에 있고 크기도 있었다. 그 좌표에 실제로 무엇이
   * 있는지 물어야 한다.
   */
  test("질의창은 결과 시트를 열어도 계속 닿는다", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await page.getByRole("button", { name: "바로 시작" }).click();

    expect(await selectorReachable(page, "#analysis-query")).toBe(true);
    expect(await selectorReachable(page, ".query-hero-submit")).toBe(true);

    // 결과 시트를 끝까지 올려도 마찬가지여야 한다.
    await page.getByRole("button", { name: "결과", exact: true }).click();
    await expect(page.locator(".copilot-panel-right")).toHaveClass(/sheet-open/);
    await page.getByRole("button", { name: "높게" }).first().click();

    expect(await selectorReachable(page, "#analysis-query")).toBe(true);
    expect(await selectorReachable(page, ".query-hero-submit")).toBe(true);

    // 닿을 뿐 아니라 실제로 답이 나와야 한다.
    await page.getByLabel("분석 질의").fill("생활인구 많은 동");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await expect(page.getByTestId("one-line-conclusion")).toContainText(/생활인구/, {
      timeout: 30_000,
    });
  });

  test("온보딩 카드가 시트 토글을 덮지 않는다", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    // 첫 방문자에게 뜨는 카드가 조작·결과 버튼 위에 겹쳐 있었다.
    await expect(page.getByTestId("onboard-card")).toBeVisible();

    expect(await isReachable(page, "조작")).toBe(true);
    expect(await isReachable(page, "결과")).toBe(true);
  });

  test("떠 있는 버튼 줄이 접히지 않는다", async ({ page }) => {
    /*
     * 이 줄은 화면 절반만 쓰고 있었다(`left:50%`+`translate`). 버튼이 둘일 때는 마침
     * 들어맞아 아무도 몰랐는데, 셋이 되자 줄이 접히면서 바가 위로 47px 자라 첫 방문
     * 안내 카드 밑으로 들어갔다 — 카드를 닫기 전에는 「조작」이 눌리지 않았다.
     *
     * 버튼 하나하나가 닿는지만 보면 다음에 넷째가 붙을 때 같은 일이 또 난다. **한 줄인지**를
     * 직접 잰다.
     */
    await page.goto("/");
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });

    const rows = await page.evaluate(() => {
      const bar = document.querySelector(".map-float-bar");
      const tops = new Set<number>();
      for (const button of bar?.querySelectorAll("button") ?? []) {
        tops.add(Math.round(button.getBoundingClientRect().top));
      }
      return { rows: tops.size, count: bar?.querySelectorAll("button").length ?? 0 };
    });
    expect(rows.count).toBeGreaterThanOrEqual(2);
    expect(rows.rows).toBe(1);

    // 줄 안의 버튼은 모두 눌려야 한다. 화면 밖으로 나가도 접히지는 않기 때문이다.
    for (const label of ["조작", "결과"]) {
      expect(await isReachable(page, label)).toBe(true);
    }
  });

  test("시트를 연 뒤에도 반대편 시트로 넘어갈 수 있다", async ({ page }) => {
    await page.goto("/");
    /*
     * h1은 준비 신호가 아니다 — 로딩 화면에도 상단 바가 있으므로 데이터가 오기 전에
     * 보인다. 본 셸이 그려졌는지로 기다린다.
     */
    await expect(page.getByTestId("copilot-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    await page.getByRole("button", { name: "바로 시작" }).click();

    // 조작을 연 상태에서 결과 버튼이 시트에 가려 눌리지 않아 한쪽에 갇히곤 했다.
    await page.getByRole("button", { name: "조작", exact: true }).click();
    await expect(page.locator(".copilot-panel-left")).toHaveClass(/sheet-open/);
    expect(await isReachable(page, "결과")).toBe(true);

    await page.getByRole("button", { name: "결과", exact: true }).click();
    await expect(page.locator(".copilot-panel-right")).toHaveClass(/sheet-open/);
    expect(await isReachable(page, "조작")).toBe(true);
  });
});
