import { expect, test } from "@playwright/test";

test.describe("mobile sheet", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows bottom sheet handle and primary tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "분석" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /부산.?경남 AI GIS|부산 AI GIS/i })).toBeVisible();

    const handles = page.locator(".sheet-handle");
    await expect(handles.first()).toBeVisible();
    await handles.first().click();

    await page.getByRole("tab", { name: "이용" }).click();
    await expect(page.getByRole("tab", { name: "이용" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("이렇게 쓰세요")).toBeVisible();
  });
});
