import { expect, test } from "@playwright/test";

test("square colours, clear categories and date columns preserve the free layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/thoughts");
  const label = `Date sort ${Date.now()}`;
  for (const suffix of ["older", "newer"]) {
    await page.getByLabel("New thought", { exact: true }).fill(`${label} ${suffix}`);
    await page.getByRole("button", { name: "Add thought", exact: true }).click();
    await expect(page.locator(".thought-note").filter({ hasText: `${label} ${suffix}` })).toBeVisible();
  }
  const notes = page.locator(".thought-note").filter({ hasText: label });
  const positions = await notes.evaluateAll(elements => Object.fromEntries(elements.map(el => [el.getAttribute("data-thought-id"), [el.style.left, el.style.top]])));
  await page.getByRole("button", { name: "Sort by date", exact: true }).click();
  await expect(page.locator(".thoughts-canvas")).toHaveAttribute("data-sort", "date");
  await expect(notes.first()).toContainText("newer");
  await expect(notes.first().getByRole("button", { name: /^Move thought/ })).toBeHidden();
  const box = (await notes.first().boundingBox())!;
  expect(box.width).toBeGreaterThan(200); expect(box.width).toBeLessThan(500);
  await page.screenshot({ path: info.outputPath("thoughts-date-columns.png") });
  await page.getByRole("button", { name: "Free sort", exact: true }).click();
  expect(await notes.evaluateAll(elements => Object.fromEntries(elements.map(el => [el.getAttribute("data-thought-id"), [el.style.left, el.style.top]])))).toEqual(positions);
  const note = notes.filter({ hasText: "newer" });
  const tint = await note.locator(".thought-colour-toggle span").evaluate(el => ({ radius: getComputedStyle(el).borderRadius, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  expect(tint.width).toBe(tint.height); expect(tint.radius).toBe("3px");
  await note.getByRole("button", { name: /^Change colour/ }).click();
  const swatch = (await note.getByRole("button", { name: "rose note", exact: true }).boundingBox())!;
  expect(swatch.width).toBe(swatch.height); expect(swatch.width).toBe(32);
  await note.getByRole("button", { name: "rose note", exact: true }).click();
  await note.getByRole("button", { name: /^Edit thought/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit thought", exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Find or create category", exact: true }).fill(label);
  await dialog.getByRole("button", { name: `Create “${label}”`, exact: true }).click();
  await expect(dialog).toContainText(`Selected: ${label}`);
  await dialog.getByRole("button", { name: "Save thought", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await notes.filter({ hasText: "older" }).getByRole("button", { name: /^Edit thought/ }).click();
  await dialog.getByRole("textbox", { name: "Find or create category", exact: true }).fill(label);
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog.getByRole("button", { name: "rose note", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("thought-category-picker.png") });
  await dialog.getByRole("button", { name: "Save thought", exact: true }).click();
  await page.reload();
  await expect(notes.locator(".thought-note-category")).toHaveCount(2);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Live projects", exact: true })).toBeVisible();
});

test("quick colour, editor exploration, spaced capture, remembered dots and optimistic drag", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/thoughts");
  const title = `Board polish ${Date.now()}`;
  await page.getByLabel("New thought", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add thought", exact: true }).click();
  const note = page.locator(".thought-note").filter({ hasText: title });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: /^Change colour/ }).click();
  await note.getByRole("button", { name: "sky note", exact: true }).click();
  await expect(note).toHaveAttribute("data-colour", "sky");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(note.getByRole("button", { name: "Explore this idea", exact: true })).toHaveText("");
  await expect(note.getByRole("button", { name: /^Move thought/ })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Dots", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Lane guides", exact: true }).check();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Dots", exact: true })).not.toBeChecked();
  await expect(page.locator(".thoughts-canvas")).toHaveAttribute("data-dots", "false");
  await expect(page.getByRole("checkbox", { name: "Lane guides", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Lane guides", exact: true }).uncheck();
  await expect(note).toHaveAttribute("data-colour", "sky");

  // Hold the actual save request: the dropped note must stay where the hand left it.
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/thoughts", async route => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) { held = true; await gate; }
    await route.continue();
  });
  const before = (await note.boundingBox())!, grip = (await note.getByRole("button", { name: /^Move thought/ }).boundingBox())!;
  await page.mouse.move(grip.x + 8, grip.y + 8); await page.mouse.down();
  await page.mouse.move(grip.x + 108, grip.y + 88, { steps: 15 }); await page.mouse.up();
  await expect.poll(() => held).toBe(true);
  expect((await note.boundingBox())!.x).toBeGreaterThan(before.x + 90);
  release();
  await expect(note.getByRole("button", { name: /^Move thought/ })).toBeEnabled();
  await page.unroute("**/thoughts");

  // A failed save restores the last confirmed position and explains recovery.
  const confirmed = await note.evaluate(el => ({ left: el.style.left, top: el.style.top }));
  let failSave = true;
  await page.route("**/thoughts", async route => {
    if (failSave && route.request().method() === "POST" && route.request().headers()["next-action"]) { failSave = false; await route.abort("failed"); }
    else await route.continue();
  });
  const again = (await note.getByRole("button", { name: /^Move thought/ }).boundingBox())!;
  await page.mouse.move(again.x + 8, again.y + 8); await page.mouse.down();
  await page.mouse.move(again.x + 108, again.y + 88, { steps: 15 }); await page.mouse.up();
  await expect(page.locator(".thoughts-page").getByRole("alert")).toContainText("Could not confirm the save");
  // The viewport can auto-scroll while dragging near its edge; compare stored
  // board coordinates rather than screen coordinates to verify rollback.
  await expect.poll(() => note.evaluate(el => ({ left: el.style.left, top: el.style.top }))).toEqual(confirmed);
  await page.unroute("**/thoughts");
  await page.getByRole("button", { name: "Reload private board", exact: true }).click();
  await expect(page.locator(".thoughts-page").getByRole("alert")).toHaveCount(0);

  await note.getByRole("button", { name: /^Edit thought/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Saved before exploration");
  await dialog.getByRole("button", { name: "Explore this idea", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(note.getByRole("heading", { name: "Saved before exploration" })).toBeVisible();
  await expect(page.getByLabel("Private explorations", { exact: true })).toContainText("Saved before exploration");
  await page.getByRole("button", { name: "Close explorations", exact: true }).click();
  await page.screenshot({ path: info.outputPath("thought-board-polish.png") });
});

test("sales model uses half the desktop grid and project voice lives in the header", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings");
  const card = page.locator(".edition-settings-card"), grid = page.locator("#settings-panel-workspace");
  await expect(card).toBeVisible();
  const ratio = (await card.boundingBox())!.width / (await grid.boundingBox())!.width;
  expect(ratio).toBeGreaterThan(.45); expect(ratio).toBeLessThan(.51);
  await page.screenshot({ path: info.outputPath("sales-model-half-width.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await card.boundingBox())!.width / (await grid.boundingBox())!.width).toBeGreaterThan(.95);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/live");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const mic = page.getByRole("dialog").locator(".dialog-header").getByRole("button", { name: "Talk through adding a project", exact: true });
  await expect(mic).toBeVisible(); await expect(mic).toHaveText("");
  await expect(page.locator(".delivery-voice-toolbar")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("project-mic-header.png") });
});
