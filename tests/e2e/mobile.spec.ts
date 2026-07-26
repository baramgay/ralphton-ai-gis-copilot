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

test.describe("mobile sheet", () => {
  // 세로가 짧은 기기에서만 드러나는 겹침이 있어 727px로 본다(Pixel 5).
  test.use({ viewport: { width: 393, height: 727 } });

  test("shows mobile chrome and can open result sheet", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /경남 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });

    await expect(page.locator(".sheet-handle").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "조작" })).toBeVisible();
    await expect(page.getByRole("button", { name: "결과" })).toBeVisible();

    await page.getByRole("button", { name: "결과" }).click({ force: true });
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("one-line-conclusion")).toBeVisible();
  });

  test("온보딩 카드가 시트 토글을 덮지 않는다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /경남 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    // 첫 방문자에게 뜨는 카드가 조작·결과 버튼 위에 겹쳐 있었다.
    await expect(page.getByTestId("onboard-card")).toBeVisible();

    expect(await isReachable(page, "조작")).toBe(true);
    expect(await isReachable(page, "결과")).toBe(true);
  });

  test("시트를 연 뒤에도 반대편 시트로 넘어갈 수 있다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /경남 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
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
