import { expect, type Page, test } from "@playwright/test";

/**
 * 모바일에서 조작·결과는 같은 자리를 쓰는 바텀시트라 한 번에 하나만 열린다. 이 스펙은
 * 데스크톱·모바일 프로젝트가 함께 돌리므로, 만질 곳을 먼저 띄우고 진행한다.
 * 데스크톱에서는 두 패널이 나란히 있어 이 토글이 없으니 아무 일도 하지 않는다.
 *
 * 이 배려가 없으면 모바일에서 닫힌 시트 안의 요소를 만지게 되는데, Playwright가 강제로
 * 스크롤해 좌표는 맞춰 놓고 정작 그 자리에는 열린 반대편 시트가 있어 클릭이 가로채인다.
 */
async function openSheet(page: Page, name: "조작" | "결과") {
  const toggle = page.getByRole("button", { name, exact: true });
  if (!(await toggle.isVisible().catch(() => false))) return;

  const side = name === "조작" ? "left" : "right";
  const panel = page.locator(`.copilot-panel-${side}`);
  if (await panel.evaluate((el) => el.classList.contains("sheet-open"))) return;

  await toggle.click({ force: true });
  await expect(panel).toHaveClass(/sheet-open/);
}

test.describe("AI GIS Copilot core journey", () => {
  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /경남 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    await openSheet(page, "결과");
    await expect(page.getByTestId("interpretation-card")).toBeVisible();
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await openSheet(page, "조작");
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
    await expect(page.getByText("이렇게 쓰세요")).toBeVisible();

    await page.getByRole("tab", { name: "데이터" }).click();
    await expect(page.getByRole("tab", { name: "데이터" })).toHaveAttribute("aria-selected", "true");
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

  test("runs natural language query path", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /경남 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    await openSheet(page, "조작");
    const input = page.getByLabel("분석 질의");
    await input.fill("창원 의료 취약");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await openSheet(page, "결과");
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("interpretation-card")).toBeVisible({ timeout: 30_000 });
  });
});
