import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import type { BoardSnapshot } from "../../src/lib/domain/types";

test.skip(process.env.AI_MODEL !== "test-model", "Run with node scripts/run-voice-e2e.mjs (loopback provider fixture).");
test.use({ timezoneId: "Europe/London" });
function snapshot() {
  const database = new Database(path.join(process.cwd(), "data/gud-e2e.db"), { readonly: true });
  try { return JSON.parse((database.prepare("SELECT snapshot_json FROM local_workspaces WHERE id = 'default'").get() as { snapshot_json: string }).snapshot_json) as BoardSnapshot; }
  finally { database.close(); }
}
async function createSales(page: Page, name: string) {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Create a new opportunity" }).click();
  await page.getByLabel("Company name", { exact: true }).fill(name);
  await page.getByLabel("Opportunity title", { exact: true }).fill("Website design");
  await page.getByRole("button", { name: "Create opportunity", exact: true }).click();
  await expect(page.locator(".opportunity-panel")).toBeVisible();
  return new URL(page.url()).searchParams.get("opportunity")!;
}

test("reviews one combined update, corrects and unticks fields, then undoes after reload", async ({ page }, info) => {
  const id = await createSales(page, "DEMO · Combined Voice Studio");
  const before = snapshot().opportunities.find((item) => item.id === id)!;
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const dialog = page.locator(".workspace-voice-dialog");
  await expect(dialog.locator(".voice-selected")).toContainText("DEMO · Combined Voice Studio");
  await dialog.getByLabel("Your update", { exact: true }).fill("Prepare a combined update with missing time.");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "One update. Ready to review." })).toBeVisible();
  expect(snapshot().opportunities.find((item) => item.id === id)).toEqual(before);
  await expect(dialog.getByRole("button", { name: "Apply 4 changes" })).toBeDisabled();
  await dialog.getByLabel("Sales estimate (£)", { exact: true }).fill("13000.25");
  await dialog.getByLabel("Include Temperature", { exact: true }).uncheck();
  await expect(dialog.getByLabel("Next action date")).toHaveValue("2026-10-16");
  await dialog.getByLabel("Next action time").fill("10:15");
  await dialog.locator(".workspace-voice-body").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("voice-review-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("voice-review-mobile.png"), animations: "disabled" });
  const apply = dialog.getByRole("button", { name: "Apply 3 changes" });
  await expect(apply).toBeInViewport();
  await apply.click();
  await expect(page.getByRole("complementary", { name: "Voice update receipt" })).toContainText("Saved · DEMO · Combined Voice Studio");
  const saved = snapshot().opportunities.find((item) => item.id === id)!;
  expect(saved.expectedValue).toBe(13000.25);
  expect(saved.temperature).toBe(before.temperature);
  expect(saved.activities).toHaveLength(before.activities.length + 1);
  expect(saved.tasks).toHaveLength(before.tasks.length + 1);
  expect(saved.tasks.at(-1)?.dueAt).toBe("2026-10-16T09:15:00.000Z");
  await page.reload();
  await page.getByRole("button", { name: "Undo update", exact: true }).click();
  await expect(page.getByText("Voice update undone", { exact: true })).toBeVisible();
  const restored = snapshot().opportunities.find((item) => item.id === id)!;
  expect(restored.expectedValue).toBe(before.expectedValue ?? null);
  expect(restored.activities).toHaveLength(before.activities.length);
  expect(restored.tasks).toHaveLength(before.tasks.length);
});

test("recovers a committed save after its response is lost, without duplicate work", async ({ page }) => {
  const id = await createSales(page, "DEMO · Interrupted Save Studio");
  const before = snapshot().opportunities.find((item) => item.id === id)!;
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const dialog = page.locator(".workspace-voice-dialog");
  await dialog.getByLabel("Your update", { exact: true }).fill("Prepare a combined update.");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  let responseLost = false;
  await page.route("**/pipeline**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.includes('"planId"') && request.postData()?.includes('"changes"')) {
      await route.fetch(); // The real isolated database commits, but the browser never receives the receipt.
      responseLost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Apply 4 changes" }).click();
  await expect.poll(() => responseLost).toBe(true);
  await expect(dialog.getByRole("alert")).toContainText("Could not confirm the save");
  expect(snapshot().opportunities.find((item) => item.id === id)?.tasks).toHaveLength(before.tasks.length + 1);
  await page.unrouteAll();
  await page.reload();
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Voice update receipt" })).toContainText("Saved · DEMO · Interrupted Save Studio");
  const recovered = snapshot().opportunities.find((item) => item.id === id)!;
  expect(recovered.activities).toHaveLength(before.activities.length + 1);
  expect(recovered.tasks).toHaveLength(before.tasks.length + 1);
  await page.getByRole("button", { name: "Undo update", exact: true }).click();
  await expect(page.getByText("Voice update undone", { exact: true })).toBeVisible();
  expect(snapshot().opportunities.find((item) => item.id === id)?.tasks).toHaveLength(before.tasks.length);
});

test("keeps words after close, navigation, clarification and provider failure", async ({ page }, info) => {
  await createSales(page, "DEMO · Draft Recovery Studio");
  await page.getByRole("button", { name: "Talk through an update", exact: true }).click();
  const dialog = page.locator(".workspace-voice-dialog");
  await dialog.getByLabel("Your update", { exact: true }).fill("Please update two clients.");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("choose one client");
  await expect(dialog.getByRole("alert")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("voice-capture-desktop.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Close voice workspace" }).click();
  await page.goto("/my-work");
  await page.keyboard.press("Control+Shift+Space");
  await expect(dialog.getByLabel("Your update", { exact: true })).toHaveValue("Please update two clients.");
  await expect(dialog.locator(".voice-selected")).toContainText("Draft Recovery Studio");
  await dialog.getByLabel("Your update", { exact: true }).fill("provider failure");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Your update", { exact: true })).toHaveValue("provider failure");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await expect(dialog.getByLabel("Your update", { exact: true })).toHaveValue("provider failure");
  await dialog.getByRole("button", { name: "Discard words" }).click();
  await expect(dialog.getByLabel("Your update", { exact: true })).toHaveValue("");
});

test("requires an explicit record globally and captures microphone words before review", async ({ page }) => {
  await page.addInitScript(() => {
    class SpeechFixture {
      onresult?: (event: unknown) => void; onend?: () => void;
      start() { setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: "The client approved the outline. Follow up on Friday at ten." }], { isFinal: true })] }), 50); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.assign(window, { SpeechRecognition: SpeechFixture });
  });
  await createSales(page, "DEMO · Microphone Studio");
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const dialog = page.locator(".workspace-voice-dialog");
  await expect(dialog.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled();
  await dialog.getByLabel("Find a voice record").fill("Microphone Studio");
  await dialog.getByRole("button", { name: /DEMO · Microphone Studio Website design Sales/ }).click();
  await dialog.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(dialog.getByText("Listening…", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Your update", { exact: true })).toContainText("The client approved");
  await expect(dialog.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "One update. Ready to review." })).toBeVisible();
});

test("opens the shared review from a live project and preserves sales figures", async ({ page }) => {
  await page.goto("/live");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Voice delivery test");
  await page.getByLabel("Organisation / client", { exact: true }).fill("DEMO · Voice Delivery Studio");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const before = snapshot().opportunities;
  await page.locator(".live-card-open").filter({ hasText: "Voice delivery test" }).click();
  await page.getByRole("button", { name: "Talk through an update", exact: true }).click();
  const dialog = page.locator(".workspace-voice-dialog");
  await expect(dialog.locator(".voice-selected")).toContainText("Voice Delivery Studio");
  await dialog.getByLabel("Your update", { exact: true }).fill("The client approved the design. Value twelve thousand five hundred pounds fifty. Move to in progress and set the first draft for Friday.");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply 5 changes" }).click();
  await expect(page.locator(".live-card-open").filter({ hasText: "Voice delivery test" })).toContainText("£12,500.50");
  expect(snapshot().opportunities).toEqual(before);
  await page.getByRole("button", { name: "Undo update", exact: true }).click();
  await expect(page.getByText("Voice update undone", { exact: true })).toBeVisible();
  expect(snapshot().directProjects?.find((item) => item.title === "Voice delivery test")?.delivery.projectValue).toBeNull();
});
