import { expect, test } from "@playwright/test";

test.describe("AI GIS Copilot core journey", () => {
  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /부산 AI GIS Copilot/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("interpretation-card")).toBeVisible();

    await page.getByTestId("quick-elderly").click();
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /고령|의료/ })).toBeVisible();

    await page.getByTestId("quick-radius").click();
    await expect(page.getByTestId("interpretation-card")).toContainText(/기준월|해석/);

    await page.getByRole("tab", { name: "이용방법" }).click();
    await expect(page.getByRole("tab", { name: "이용방법" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "데이터 정보" }).click();
    await expect(page.getByRole("tab", { name: "데이터 정보" })).toHaveAttribute("aria-selected", "true");
  });
});
