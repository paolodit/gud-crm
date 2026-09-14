import { expect, test, type Locator, type Page } from "@playwright/test";

async function panBoard(page: Page, viewport: Locator, distance: number) {
  const box = (await viewport.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 8; // Board padding, not a draggable card or control.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(viewport).not.toHaveAttribute("data-panning", "true");
  await page.mouse.move(x - distance, y, { steps: 12 });
  await expect(viewport).toHaveAttribute("data-panning", "true");
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("data-panning", "true");
}

test("pipeline header double-click survives grab scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/pipeline");
  for (const name of ["DEMO · Header first", "DEMO · Header second"]) {
    await page.getByRole("button", { name: "Create a new opportunity" }).click();
    await page.getByLabel("Company name", { exact: true }).fill(name);
    await page.getByLabel("Opportunity title", { exact: true }).fill("Header gesture check");
    await page.getByRole("button", { name: "Create opportunity", exact: true }).click();
    await expect(page.locator(".opportunity-panel")).toBeVisible();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
  }
  const viewport = page.locator(".board-viewport").filter({ visible: true });
  const column = viewport.locator(".board-column").filter({ has: page.locator(".column-expand") }).first();
  const header = column.locator(".column-header");
  for (const target of [header.locator("strong"), header.locator(".column-count")]) {
    await target.dblclick();
    await expect(column).toHaveAttribute("data-expanded", "true");
    await target.dblclick();
    await expect(column).toHaveAttribute("data-expanded", "false");
  }
  await header.dblclick({ position: { x: 4, y: 4 } });
  await expect(column).toHaveAttribute("data-expanded", "true");
  await column.locator(".column-expand").click();
  await expect(column).toHaveAttribute("data-expanded", "false");
  await page.reload(); // Start panning at the left edge, not an auto-scrolled count badge.
  await expect(viewport).toBeVisible();
  const initialScroll = await viewport.evaluate((e) => e.scrollLeft);
  await panBoard(page, viewport, 180);
  expect(await viewport.evaluate((e) => e.scrollLeft)).toBeGreaterThan(initialScroll + 100);
  await panBoard(page, viewport, -180);
  await expect.poll(() => viewport.evaluate((e) => e.scrollLeft)).toBe(initialScroll);
  await column.locator(".card-voice-action").first().click();
  await expect(page.locator(".workspace-voice-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close voice workspace" }).click();
  await expect(page.locator(".workspace-voice-dialog")).toHaveCount(0);
  await expect(page.locator(".opportunity-panel")).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(page.locator(".opportunity-panel")).toHaveCount(0);
  await header.locator("strong").dblclick();
  await expect(column).toHaveAttribute("data-expanded", "true");
  await column.locator(".column-expand").click();
  await column.locator(".card-open").first().click();
  await expect(page.locator(".opportunity-panel")).toBeVisible();
});

test("live board pans in both directions and keeps cards flush in both densities", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/live");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("DEMO · Pan project");
  await page.getByLabel("Organisation / client", { exact: true }).fill("DEMO · Pan client");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator(".live-card").filter({ hasText: "DEMO · Pan project" });
  const column = page.getByRole("region", { name: "Kickoff", exact: true });
  const viewport = page.locator(".live-board-viewport").filter({ visible: true });
  for (const density of ["Compact", "Comfortable"]) {
    await page.getByRole("group", { name: "Live project card density" }).getByRole("button", { name: density, exact: true }).click();
    await expect.poll(async () => Math.round((await column.boundingBox())!.width)).toBe(density === "Compact" ? 220 : 240);
    await expect.poll(() => card.evaluate((element) => {
      const cardBox = element.getBoundingClientRect();
      const columnBox = element.closest(".live-column")!.getBoundingClientRect();
      return Math.max(Math.abs(columnBox.width - cardBox.width), Math.abs(columnBox.x - cardBox.x));
    })).toBeLessThanOrEqual(1);
    await panBoard(page, viewport, 180);
    const scrolledRight = await viewport.evaluate((e) => e.scrollLeft);
    expect(scrolledRight).toBeGreaterThan(100);
    await panBoard(page, viewport, -180);
    await expect.poll(() => viewport.evaluate((e) => e.scrollLeft)).toBeLessThan(scrolledRight - 100);
  }
  await column.getByRole("heading", { name: "Kickoff", exact: true }).dblclick();
  await expect(column).toHaveAttribute("data-expanded", "true");
  await column.getByRole("button", { name: "Collapse Kickoff to one lane" }).click();
  await expect(column).toHaveAttribute("data-expanded", "false");
  await card.locator(".live-card-open").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.getByRole("button", { name: "Update DEMO · Pan client project by voice or text" }).click();
  await expect(page.locator(".workspace-voice-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close voice workspace" }).click();
  await page.screenshot({ path: info.outputPath("live-flush-cards.png"), animations: "disabled" });
});
