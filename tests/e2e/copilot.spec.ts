import { expect, test } from "@playwright/test";

test.describe("AI GIS Copilot core journey", () => {
  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /부산.?경남 AI GIS|부산 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("interpretation-card")).toBeVisible();
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await page.getByTestId("quick-elderly").click();
    await expect(page.getByTestId("interpretation-card")).toBeVisible();

    await page.getByTestId("quick-radius").click();
    await expect(page.getByTestId("interpretation-card")).toContainText(
      /기준월|해석|반경|접근|의료/,
    );

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

    await expect(page.getByTestId("sido-scope-all")).toBeVisible();
    await page.getByTestId("sido-scope-busan").click();
    await expect(page.getByText("부산광역시").first()).toBeVisible();

    await page.getByTestId("theme-dark").click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");
  });

  test("runs natural language query path", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /부산.?경남 AI GIS|부산 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    const input = page.getByLabel("분석 질의");
    await input.fill("창원 의료 취약");
    await page.getByRole("button", { name: "질의 실행" }).click();
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("interpretation-card")).toBeVisible({ timeout: 30_000 });
  });
});
