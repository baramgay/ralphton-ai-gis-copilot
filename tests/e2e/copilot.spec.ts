import { expect, test } from "@playwright/test";

test.describe("AI GIS Copilot core journey", () => {
  test("loads demo shell and runs quick analyses", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /부산 AI GIS/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("interpretation-card")).toBeVisible();
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await page.getByTestId("quick-elderly").click();
    await expect(page.getByTestId("interpretation-card")).toBeVisible();

    await page.getByTestId("quick-radius").click();
    await expect(page.getByTestId("interpretation-card")).toContainText(/기준월|해석|반경|접근|의료/);

    await page.getByRole("tab", { name: "이용" }).click();
    await expect(page.getByRole("tab", { name: "이용" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("이렇게 쓰세요")).toBeVisible();

    await page.getByRole("tab", { name: "데이터" }).click();
    await expect(page.getByRole("tab", { name: "데이터" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/시연|실데이터/)).toBeVisible();

    await page.getByRole("tab", { name: "분석" }).click();
    await page.getByText("화면 설정").click();
    await expect(page.getByRole("button", { name: "다크" })).toBeVisible();
  });
});
