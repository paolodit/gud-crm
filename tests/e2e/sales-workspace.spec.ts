import { expect, test } from "@playwright/test";

test.describe.serial("Service Sales workspace", () => {
  test("starts with the Service Sales model", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sales model" })).toBeVisible();
    const edition = page.locator(".edition-current");
    await expect(edition.getByText("Service Sales", { exact: true })).toBeVisible();
    await expect(edition.getByText("Consultancies, agencies and independent specialists", { exact: true })).toBeVisible();
  });

  test("creates an opportunity with optional commercial context", async ({ page }) => {
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Create a new opportunity" }).click();

    await page.getByLabel("Company name").fill("DEMO · Bright Harbour Studio");
    await page.getByLabel("Opportunity title").fill("Website strategy and build");
    await page.getByText("Commercial outlook", { exact: false }).click();
    await page.getByLabel("Potential value (£)").fill("18000");
    await page.getByLabel("Probability").selectOption("40");
    await page.getByLabel("Expected close").fill("2026-09-30");
    await page.getByRole("button", { name: "Create opportunity" }).click();

    await expect(page.getByRole("heading", { name: "DEMO · Bright Harbour Studio" })).toBeVisible();
    await expect(page.getByText("£18,000", { exact: true })).toBeVisible();
    await expect(page.getByText("40%", { exact: true })).toBeVisible();
    await expect(page.getByText("30 Sep 2026", { exact: true })).toBeVisible();
  });
});
