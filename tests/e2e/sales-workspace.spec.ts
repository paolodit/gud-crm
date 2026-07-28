import { expect, test } from "@playwright/test";

test.describe.serial("Service Sales workspace", () => {
  test("opens the whole pipeline as the workspace home", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/pipeline$/);
    await expect(page.getByRole("heading", { name: "Service Sales" })).toBeVisible();
  });

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

  test("spreads a busy stage across two lanes", async ({ page }) => {
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Create a new opportunity" }).click();
    await page.getByLabel("Company name").fill("DEMO · Second Studio");
    await page.getByLabel("Opportunity title").fill("Second website opportunity");
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.goto("/pipeline");

    const spread = page.getByRole("button", { name: "Spread Ready to contact across two lanes" });
    await expect(spread).toBeVisible();
    await spread.click();
    await expect(page.getByRole("button", { name: "Return Ready to contact to one lane" })).toHaveAttribute("aria-pressed", "true");
  });
});
