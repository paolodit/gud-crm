// Isolated authenticated fixture only; synthetic speech, no microphone/provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const baseURL = process.env.CONVERSATION_TEST_BASE_URL;
if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1") throw new Error("Local fixture required.");
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1501, height: 1000 } });
const login = await context.request.post("/api/auth/sign-in/email", { headers: { Origin: baseURL }, data: { email: process.env.AUTH_SMOKE_EMAIL, password: process.env.AUTH_SMOKE_PASSWORD } });
assert.equal(login.ok(), true);
const page = await context.newPage(), errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.addInitScript(() => {
  window.speechStarts = 0;
  window.SpeechRecognition = class {
    start() { window.speechStarts++; }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  };
});
try {
  const name = "Annotation fixture " + randomUUID().slice(0, 8);
  await page.goto("/thoughts");
  await page.getByLabel("New thought", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add thought", exact: true }).click();
  const note = page.getByRole("button", { name: "Edit thought " + name, exact: true });
  await note.click();
  const editor = page.getByRole("dialog", { name: "Edit thought" });
  assert.equal(await editor.locator("#thought-editor-title").evaluate(el => el.classList.contains("sr-only")), true);
  await editor.getByRole("textbox", { name: "Thought", exact: true }).fill(name + " saved on outside click");
  await page.locator(".thoughts-modal").click({ position: { x: 8, y: 8 } });
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Edit thought " + name + " saved on outside click", exact: true }).click();
  await editor.getByRole("button", { name: "Voice edit thought", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.speechStarts), 1);
  await editor.getByRole("button", { name: "Stop recording", exact: true }).click();
  await editor.getByRole("button", { name: "Cancel voice edit" }).click();
  await page.screenshot({ path: ".codex-tmp/thought-editor-annotations.png" });
  await editor.getByRole("button", { name: "Close thought editor" }).click();
  await page.getByRole("button", { name: "Sort by date", exact: true }).click();
  await expect(page.getByRole("group", { name: "Arrange thoughts" })).not.toContainText("Newest first");
  for (const [path, open, mic] of [["/live", "Add project", "Talk through adding a project"], ["/pipeline", "Create a new opportunity", "Talk it through"]]) {
    await page.goto(path);
    await page.getByRole("button", { name: open, exact: true }).click();
    await page.getByRole("button", { name: mic, exact: true }).click();
    await expect(page.locator(".voice-dialog").getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.speechStarts), 1);
    await page.getByRole("button", { name: "Cancel voice input" }).click();
  }
  await page.goto("/research");
  await page.getByRole("button", { name: "Add idea", exact: true }).click();
  const idea = page.getByRole("dialog");
  await idea.getByLabel("Research question").fill(name);
  await idea.getByText("Audience and possible service", { exact: true }).click();
  await idea.getByRole("radio", { name: /Testing the evidence/ }).check();
  await expect(idea.getByLabel("Possible service or product", { exact: false })).toHaveValue("");
  await idea.getByLabel("New service idea and angles to test", { exact: true }).fill("A completely new service for independent hotels");
  await page.screenshot({ path: ".codex-tmp/marketing-idea-annotations.png" });
  await idea.getByRole("button", { name: "Save theme", exact: true }).click();
  await expect(idea).toHaveCount(0);
  await expect(page.locator(".theme-inspector")).toContainText(name);
  await expect(page.getByRole("button", { name: "Talk it through", exact: true })).toBeVisible();
  await page.goto("/targets");
  await page.getByRole("button", { name: "Add target", exact: true }).click();
  const company = page.getByRole("dialog", { name: "Add a company", exact: true });
  await company.getByLabel("Company name", { exact: true }).fill(name + " target");
  await company.getByRole("button", { name: "Add company", exact: true }).click();
  await expect(company).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Selected research target" })).toContainText(name + " target");
  const linkedIdea = page.getByRole("checkbox", { name, exact: true });
  await linkedIdea.check();
  await expect(linkedIdea).toBeEnabled();
  await expect(page.getByText("Marketing idea links saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(linkedIdea).toBeChecked();
  const service = page.locator(".research-fit-strip select");
  const firstService = await service.locator('option:not([value=""])').first().getAttribute("value");
  assert.ok(firstService);
  await service.selectOption(firstService);
  await expect(page.getByText("Offer assigned. This target can now be promoted when the research is ready.", { exact: true })).toBeVisible();
  await expect(service).toHaveValue(firstService);
  await service.selectOption("");
  await expect(page.getByText("Offer cleared while this target remains in research.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(service).toHaveValue("");
  await expect(linkedIdea).toBeChecked();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".codex-tmp/target-links-annotations.png", animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("Annotation UI checks passed: backdrop save persisted, accessible hidden heading, one-click mic on Thoughts/Projects/Pipeline, stable sort controls, new-service research state and target idea links.");
} finally { await browser.close(); }
