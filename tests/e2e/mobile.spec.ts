import { expect, test } from "@playwright/test";

test.describe("mobile sheet", () => {
  test.use({ viewport: { width: 390, height: 844 } });

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
});
