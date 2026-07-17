import { expect, test } from "@playwright/test";

test.describe("mobile sheet", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows bottom sheet controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "분석" })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".mobile-sheet-toggle")).toBeVisible();
    await page.locator(".mobile-sheet-toggle").click();
    await expect(page.locator(".copilot-panel")).toHaveClass(/sheet-expanded/);
  });
});
