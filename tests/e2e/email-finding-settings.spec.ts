import { expect, test } from "@playwright/test";

test("email setup lives in Settings and returns to the contact without running a lookup", async ({ page }, info) => {
  await page.goto("/targets");
  await page.getByRole("button", { name: "Add target", exact: true }).click();
  await page.getByLabel("Company name", { exact: true }).fill("DEMO · Email Settings Studio");
  await page.getByLabel("Website", { exact: true }).fill("https://email-settings.example");
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await expect(page).toHaveURL(/\/targets\?target=/);
  const targetId = new URL(page.url()).searchParams.get("target")!;
  const targetPath = `/targets?target=${targetId}`;
  const contactSection = page.locator(".research-section").filter({ has: page.getByRole("heading", { name: "Contact routes", exact: true }) });
  await contactSection.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Robin Example");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(contactSection.getByRole("button", { name: "Find work email", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Hunter API key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find emails", exact: true })).toHaveCount(0);
  await contactSection.getByRole("link", { name: "Set up email finding" }).click();
  await expect(page).toHaveURL(new RegExp(`/settings\\?tab=ai&section=email-finding&returnTarget=${targetId}#email-finding$`));
  await expect(page.getByRole("tab", { name: "AI & connections" })).toHaveAttribute("aria-selected", "true");
  const settings = page.getByRole("article", { name: "Email finding", exact: true });
  await expect(settings.getByRole("heading", { name: "Email finding", exact: true })).toBeInViewport();
  await expect(settings.getByRole("link", { name: "Back to target" })).toHaveAttribute("href", targetPath);

  // Synthetic key in the isolated SQLite fixture only. Never click Find work email:
  // this test verifies configuration/navigation without contacting either provider.
  await settings.getByLabel("Hunter API key", { exact: true }).fill("e2e-placeholder-not-a-provider-key");
  await settings.getByRole("radio", { name: "Voila Norbert", exact: true }).check();
  await settings.getByRole("button", { name: "Save provider setup" }).click();
  await expect(settings.getByRole("status")).toContainText("Provider setup saved");
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toHaveValue("");
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toHaveAttribute("placeholder", "Connected · paste to replace");
  await expect(settings.locator(".enrichment-provider-grid")).toContainText("Voila Norbert · First");
  await settings.getByRole("link", { name: "Back to target" }).click();
  await expect(page).toHaveURL(targetPath);
  await expect(page.getByRole("heading", { name: "DEMO · Email Settings Studio", exact: true })).toBeVisible();
  await expect(contactSection.getByRole("button", { name: "Find work email", exact: true })).toBeEnabled();
  await expect(contactSection).toContainText("Email finding connected");
  await expect(page.getByLabel("Hunter API key")).toHaveCount(0);
  await contactSection.screenshot({ path: info.outputPath("contact-email-action.png"), caret: "initial" });

  await contactSection.getByRole("link", { name: "Email settings", exact: true }).click();
  await settings.getByRole("button", { name: "Save provider setup" }).click();
  await expect(settings.getByRole("status")).toContainText("Provider setup saved");
  await page.reload();
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toHaveValue("");
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toHaveAttribute("placeholder", "Connected · paste to replace");
  await expect(settings.getByRole("radio", { name: "Voila Norbert", exact: true })).toBeChecked();
  await settings.screenshot({ path: info.outputPath("email-settings-desktop.png"), caret: "initial" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(settings.getByRole("heading", { name: "Email finding", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await settings.screenshot({ path: info.outputPath("email-settings-mobile.png"), caret: "initial" });

  await settings.getByRole("checkbox", { name: "Disconnect Hunter", exact: true }).check();
  await settings.getByRole("button", { name: "Save provider setup" }).click();
  await expect(settings.getByRole("status")).toContainText("Provider setup saved");
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toHaveAttribute("placeholder", "Paste Hunter key");
  await settings.getByRole("link", { name: "Back to target" }).click();
  await expect(contactSection.getByRole("button", { name: "Find work email", exact: true })).toBeDisabled();
});

test("email setup remains discoverable through Settings and rejects an unsafe return URL", async ({ page }) => {
  await page.goto("/settings?returnTarget=https%3A%2F%2Fexample.com");
  await page.getByRole("tab", { name: "AI & connections" }).click();
  const settings = page.getByRole("article", { name: "Email finding", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("link", { name: "Back to target" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.getByRole("tab", { name: "AI & connections" }).click();
  await expect(settings.getByLabel("Hunter API key", { exact: true })).toBeVisible();
});
