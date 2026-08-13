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

  test("lets an admin add and safely remove a pipeline stage", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add stage" }).click();
    await page.getByLabel("Name").fill("Commercial review");
    await page.getByLabel("Meaning").selectOption("open");
    await page.getByRole("button", { name: "Save stage" }).click();

    const stage = page.locator(".stage-settings-edit").filter({ hasText: "Commercial review" });
    await expect(stage).toBeVisible();
    await stage.click();
    await page.getByRole("button", { name: "Remove stage" }).click();
    await page.getByLabel("Move opportunities to").selectOption({ label: "Outreach active" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Move and remove" }).click();
    await expect(stage).toHaveCount(0);
  });

  test("keeps market ideas and named targets in separate workspaces", async ({ page }) => {
    await page.goto("/research");
    await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Targets", exact: true })).toBeVisible();
    await expect(page.locator(".research-overview")).toHaveCount(0);
    await page.getByRole("button", { name: "Add idea" }).click();
    await page.getByLabel("Research question").fill("DEMO · A useful market question");
    await page.getByRole("button", { name: "Save theme" }).click();
    await expect(page.getByRole("button", { name: "Reorder DEMO · A useful market question" })).toBeVisible();

    await page.getByRole("link", { name: "Targets", exact: true }).click();
    await expect(page).toHaveURL(/\/targets$/);
    await expect(page.getByRole("heading", { name: "Targets", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Research with AI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find emails" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Research targets" })).toBeVisible();
    await expect(page.locator(".research-inspector")).toHaveCount(0);
  });

  test("presents the sales guide as a simple first-use path", async ({ page }) => {
    await page.goto("/playbook");
    await expect(page.getByRole("heading", { name: "Sales guide" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Three steps are enough" })).toBeVisible();
    await expect(page.getByText("Plan an outreach rhythm", { exact: true })).toBeVisible();
    await expect(page.getByText("Check what proof is ready", { exact: true })).toBeVisible();
    await expect(page.locator(".playbook-tool[open]")).toHaveCount(0);
  });

  test("explains required opportunity fields and accepts a bare optional website", async ({ page }) => {
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Create a new opportunity" }).click();

    await page.getByRole("button", { name: "Create opportunity" }).click();
    await expect(page.locator(".opportunity-create-form .form-error")).toContainText("Add the opportunity");
    await page.getByLabel("Opportunity title").fill("Bare-domain website project");
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await expect(page.locator(".opportunity-create-form .form-error")).toContainText("Add the organisation");

    await page.getByLabel("Company name").fill("DEMO · Optional Website Studio");
    await page.getByText("Organisation details", { exact: false }).click();
    await page.getByLabel("Website").fill("optional-website.example");
    await page.getByRole("button", { name: "Create opportunity" }).click();

    await expect(page.getByRole("heading", { name: "DEMO · Optional Website Studio" })).toBeVisible();
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

    const spread = page.getByRole("button", { name: "Spread Outreach active across two lanes" });
    await expect(spread).toBeVisible();
    await spread.click();
    await expect(page.getByRole("button", { name: "Return Outreach active to one lane" })).toHaveAttribute("aria-pressed", "true");
  });

  test("pulls the pipeline sideways from empty board space", async ({ page }) => {
    await page.goto("/pipeline");
    const viewport = page.locator(".board-viewport");
    const emptyColumn = page.locator(".empty-column").first();
    await expect(viewport).toBeVisible();
    await expect(emptyColumn).toBeVisible();
    expect(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    const box = await emptyColumn.boundingBox();
    expect(box).not.toBeNull();
    const before = await viewport.evaluate((element) => element.scrollLeft);
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 220, startY, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  });
});
