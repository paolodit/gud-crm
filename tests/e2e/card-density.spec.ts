import { expect, test, type Page } from "@playwright/test";

const pages = [
  { path: "/pipeline", label: "Pipeline", group: "Pipeline card density" },
  { path: "/live", label: "Live projects", group: "Live project card density" },
  { path: "/companies", label: "Companies", group: "Company card density" },
] as const;

async function choose(page: Page, group: string, density: "Comfortable" | "Compact") {
  const toggle = page.getByRole("group", { name: group });
  await toggle.getByRole("button", { name: density, exact: true }).click();
  await expect(toggle.getByRole("button", { name: density, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("every density switch remembers both choices after reload, navigation and a new tab", async ({ page, context }) => {
  for (const item of pages) {
    await page.goto(item.path);
    await choose(page, item.group, "Compact");
    await page.reload();
    await expect(page.getByRole("group", { name: item.group }).getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Today", exact: true }).click();
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: item.label, exact: true }).click();
    await expect(page.getByRole("group", { name: item.group }).getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    const revisit = await context.newPage();
    await revisit.goto(item.path);
    await expect(revisit.getByRole("group", { name: item.group }).getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await revisit.close();
    await choose(page, item.group, "Comfortable");
    await page.reload();
    await expect(page.getByRole("group", { name: item.group }).getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  // One page's saved state must not become the default for another page.
  await page.goto("/pipeline"); await choose(page, "Pipeline card density", "Compact");
  await page.goto("/live");
  await expect(page.getByRole("group", { name: "Live project card density" }).getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/companies");
  await expect(page.getByRole("group", { name: "Company card density" }).getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Thoughts has its own existing user-scoped preferences, including lane guides.
  await page.goto("/thoughts");
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await page.getByLabel("Lane guides").check();
  await page.reload();
  await expect(page.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Lane guides")).toBeChecked();
  await page.getByRole("button", { name: "Comfortable", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("switchers remain usable when preference storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key.startsWith("gud-card-density:")) throw new DOMException("Blocked", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("gud-card-density:")) throw new DOMException("Blocked", "SecurityError"); return set.call(this, key, value); };
  });
  for (const item of pages) { await page.goto(item.path); await choose(page, item.group, "Compact"); await choose(page, item.group, "Comfortable"); }
});
