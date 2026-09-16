// Browser-only transport fixture against the disposable authenticated CI app.
// No OpenAI calls and no customer data writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const baseURL = "http://127.0.0.1:3000";
if (!process.env.AUTH_SMOKE_EMAIL || !process.env.AUTH_SMOKE_PASSWORD) throw new Error("CI auth credentials required.");
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
const login = await context.request.post("/api/auth/sign-in/email", { headers: { Origin: baseURL }, data: { email: process.env.AUTH_SMOKE_EMAIL, password: process.env.AUTH_SMOKE_PASSWORD } });
assert.equal(login.ok(), true);
const page = await context.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const offerId = randomUUID(), stageId = randomUUID();
const references = { offers: [{ id: offerId, name: "Websites" }], stages: [{ id: stageId, name: "Outreach active" }], projectStages: [{ id: "kickoff", name: "Kickoff" }], thoughtsAllowed: true };
let drafts = [], saves = 0, failSave = true;
await page.route("**/api/gud-conversation", async route => {
  const { op, input } = route.request().postDataJSON();
  let result = {};
  if (op === "load") result = { drafts, references };
  if (op === "start") result = { session: { id: randomUUID(), expiresAt: new Date(Date.now()+600000).toISOString() }, drafts, references };
  if (op === "text") {
    drafts = [{ id: randomUUID(), kind: "lead", fields: { company: "Acme", title: "Website", contact: "Sarah", value: 5000, offerId, stageId, task: "Follow up", dueDate: "2026-09-17", dueTime: "10:00", note: "Before Christmas" }, timezone: "Europe/London", version: 1, status: "draft", label: "Acme website", warnings: [], baseline: "new", expiresAt: new Date(Date.now()+86400000).toISOString() }];
    result = { message: "Ready for you to review.", drafts, events: [{ navigate: "/pipeline" }] };
  }
  if (op === "edit") { drafts = drafts.map(d => d.id === input.id ? { ...d, version: d.version+1, fields: { ...d.fields, ...input.fields } } : d); result = { draft: drafts.find(d => d.id === input.id) }; }
  if (op === "save") {
    saves++;
    if (failSave) { failSave = false; await route.fulfill({ status: 400, json: { error: "Fixture save failed. Nothing was saved." } }); return; }
    assert.equal(drafts[0].fields.value, 6200); drafts = []; result = { drafts, receipts: [{ draftId: input[0].id, href: "/pipeline", label: "Acme website" }] };
  }
  if (op === "end") result = { ok: true };
  await route.fulfill({ json: result });
});
try {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "GUD conversation preview" });
  await panel.getByRole("checkbox").check();
  await panel.getByRole("textbox", { name: "Message GUD" }).fill("Sarah at Acme wants a £5000 website before Christmas.");
  await panel.getByRole("button", { name: "Send message to GUD" }).click();
  await panel.getByLabel("Value (£)").fill("6200");
  assert.equal(saves, 0);
  await page.getByRole("link", { name: "Live projects", exact: true }).click();
  await page.waitForURL("**/live");
  assert.equal(await panel.getByLabel("Value (£)").inputValue(), "6200");
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await panel.getByText("Saved. All Gud.", { exact: true }).count(), 0);
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByText("Saved. All Gud.", { exact: true }).waitFor();
  assert.equal(saves, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x+bounds.width <= 390);
  await panel.getByRole("button", { name: "Close conversation", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("Conversation browser checks passed: consent, draft/edit, route persistence, failed-save honesty, retry, All Gud sign-off and mobile fit.");
} finally { await browser.close(); }
