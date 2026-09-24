import { expect, test } from "@playwright/test";

test("interactive demo supports Thoughts and explains shared-login visibility", async ({ page }) => {
  test.skip(process.env.GUD_PUBLIC_DEMO !== "true", "Run with the interactive demo policy enabled");
  await page.goto("/thoughts");
  await expect(page.getByRole("note")).toContainText("same shared demo login");
  await page.getByLabel("New thought", { exact: true }).fill("Fictional demo workshop idea");
  await page.getByLabel("New thought", { exact: true }).press("Enter");
  const note = page.locator(".thought-note").filter({ hasText: "Fictional demo workshop idea" });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: /^Edit thought/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "rose note" }).click();
  await dialog.getByLabel("Add a checklist item").fill("Explore a fictional venue");
  await dialog.getByLabel("Add a checklist item").press("Enter");
  await dialog.getByRole("button", { name: "Save thought", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Thought saved to this demo account" })).toBeVisible();
  await page.reload();
  await expect(note).toHaveAttribute("data-colour", "rose");
  await expect(note.getByRole("button", { name: "Explore a fictional venue" })).toBeVisible();
});
