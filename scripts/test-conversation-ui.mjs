// Browser-only transport fixture against the disposable authenticated CI app.
// No OpenAI calls and no customer data writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
if (!process.env.AUTH_SMOKE_EMAIL || !process.env.AUTH_SMOKE_PASSWORD) throw new Error("CI auth credentials required.");
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
const login = await context.request.post("/api/auth/sign-in/email", { headers: { Origin: baseURL }, data: { email: process.env.AUTH_SMOKE_EMAIL, password: process.env.AUTH_SMOKE_PASSWORD } });
assert.equal(login.ok(), true);
const page = await context.newPage();
// Exercise the real client lifecycle without a physical microphone, provider
// connection, OpenAI account or model call.
await page.addInitScript(() => {
  window.fixtureVoice = { peers: [], tracks: [], sent: [] };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
    if (window.fixtureVoice.deferMicrophone) await new Promise(resolve => { window.fixtureVoice.allowMicrophone = resolve; });
    const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
    window.fixtureVoice.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } });
  window.RTCPeerConnection = class {
    connectionState = "new";
    constructor() { window.fixtureVoice.peers.push(this); }
    addTrack() {}
    createDataChannel() {
      this.dc = { readyState: "connecting", send: data => window.fixtureVoice.sent.push(JSON.parse(data)), close() { this.readyState = "closed"; this.onclose?.(); } };
      return this.dc;
    }
    async createOffer() { return { type: "offer", sdp: "fixture-offer-sdp" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.connectionState = "connected"; this.dc.readyState = "open"; this.dc.onopen?.(); }
    close() { this.connectionState = "closed"; }
  };
});
const errors = []; page.on("pageerror", e => errors.push(e.message));
const offerId = randomUUID(), stageId = randomUUID();
const references = { offers: [{ id: offerId, name: "Websites" }], stages: [{ id: stageId, name: "Outreach active" }], projectStages: [{ id: "kickoff", name: "Kickoff" }], thoughtsAllowed: true };
let drafts = [], saves = 0, failSave = true, endCalls = 0, toolCalls = 0, failEditId = null;
let toolHandler = async () => ({ finish: true }), saveCheck = () => assert.equal(drafts[0].fields.value, 6200), beforeStartReply = async () => {};
const voiceRequests = [];
const operations = [];
const makeDraft = (label, fields = {}) => ({ id: randomUUID(), kind: "thought", fields: { title: label, body: "Fixture only", ...fields }, timezone: "Europe/London", version: 1, status: "draft", label, warnings: [], baseline: "new", expiresAt: new Date(Date.now()+86400000).toISOString() });
await page.route("**/api/gud-conversation", async route => {
  const { op, input } = route.request().postDataJSON();
  operations.push(op);
  let result = {};
  if (op === "load") result = { drafts, references };
  if (op === "start") { await beforeStartReply(); result = { session: { id: randomUUID(), expiresAt: new Date(Date.now()+600000).toISOString() }, drafts, references }; }
  if (op === "text") {
    drafts = [{ id: randomUUID(), kind: "lead", fields: { company: "Acme", title: "Website", contact: "Sarah", value: 5000, offerId, stageId, task: "Follow up", dueDate: "2026-09-17", dueTime: "10:00", note: "Before Christmas" }, timezone: "Europe/London", version: 1, status: "draft", label: "Acme website", warnings: [], baseline: "new", expiresAt: new Date(Date.now()+86400000).toISOString() }];
    result = { message: "Ready for you to review.", drafts, events: [{ navigate: "/pipeline" }] };
  }
  if (op === "edit") {
    if (input.id === failEditId) { failEditId = null; await route.fulfill({ status: 400, json: { error: "Fixture edit interrupted. Retry safely." } }); return; }
    assert.equal(input.version, drafts.find(d => d.id === input.id)?.version, "Edit retry must use the acknowledged version");
    drafts = drafts.map(d => d.id === input.id ? { ...d, version: d.version+1, fields: { ...d.fields, ...input.fields } } : d); result = { draft: drafts.find(d => d.id === input.id) };
  }
  if (op === "save") {
    saves++;
    if (failSave) { failSave = false; await route.fulfill({ status: 400, json: { error: "Fixture save failed. Nothing was saved." } }); return; }
    saveCheck(); drafts = []; result = { drafts, receipts: [{ draftId: input[0].id, href: "/pipeline", label: "Fixture saved" }] };
  }
  if (op === "end") { endCalls++; result = { ok: true }; }
  if (op === "voice") { voiceRequests.push(input); result = { sdp: "fixture-answer-sdp" }; }
  if (op === "tool") { toolCalls++; result = await toolHandler(input); }
  await route.fulfill({ json: result });
});
try {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "GUD conversation preview" });
  assert.notEqual(await panel.getByRole("button", { name: "Close conversation", exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)", "Header controls need a contrasting background");
  // First launch still requires informed consent; no microphone on page load.
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.length), 0);
  await panel.getByRole("button", { name: "Options", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "Conversation first", exact: true })).toBeChecked();
  await panel.getByLabel("GUD voice", { exact: true }).selectOption("cedar");
  // Prove SDP preparation overlaps the session request, rather than guessing
  // performance from a flaky wall-clock threshold.
  beforeStartReply = async () => { await page.waitForFunction(() => window.fixtureVoice.peers.length === 1); };
  await panel.getByRole("checkbox", { name: /Allow my conversation/ }).click();
  await panel.getByRole("button", { name: "Mute", exact: true }).waitFor();
  beforeStartReply = async () => {};
  assert.equal(voiceRequests.at(-1).voice, "cedar");
  await expect(panel.getByLabel("GUD voice", { exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(() => window.fixtureVoice.sent.some(e => e.type === "response.create" && e.response?.tool_choice === "none")), true);
  await panel.getByRole("button", { name: "End", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  await panel.getByRole("checkbox", { name: "Conversation first", exact: true }).uncheck();
  await panel.getByRole("button", { name: "Options", exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "Start conversation", exact: true }).isEnabled(), true);
  await panel.getByRole("textbox", { name: "Message GUD" }).fill("Sarah at Acme wants a £5000 website before Christmas.");
  await panel.getByRole("button", { name: "Send message to GUD" }).click();
  await panel.getByLabel("Value (£)").fill("");
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "empty amount is not treated as £0" }).waitFor();
  assert.equal(saves, 0);
  await panel.getByLabel("Value (£)").fill("6200");
  assert.equal(saves, 0);
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Live projects", exact: true }).click();
  await page.waitForURL("**/live");
  assert.equal(await panel.getByLabel("Value (£)").inputValue(), "6200");
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await panel.getByText(/Saved\. All Gud\./).count(), 0);
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByText(/Saved\. All Gud\./).waitFor();
  assert.equal(saves, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x+bounds.width <= 390);
  await panel.getByRole("button", { name: "Close conversation", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  const emit = value => page.evaluate(event => window.fixtureVoice.peers.at(-1).dc.onmessage({ data: JSON.stringify(event) }), value);
  const call = (name, id) => emit({ type: "response.done", response: { id: `response-${id}`, status: "completed", output: [{ type: "function_call", name, arguments: "{}", call_id: id }] } });
  const startVoice = async () => {
    await panel.getByRole("button", { name: "Start conversation", exact: true }).click();
    await panel.getByRole("button", { name: "Mute", exact: true }).waitFor();
  };

  // The final sign-off must play completely, even if the preceding audio stops
  // after the finish tool. The provider response metadata identifies our audio.
  await startVoice();
  // The UI follows navigation, but an open human editor takes priority.
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Live projects", exact: true }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Delivery notes", { exact: true }).fill("Human work must stay here");
  toolHandler = async () => ({ navigate: "/pipeline" });
  await call("navigate", "protected-navigation");
  await panel.getByRole("alert").filter({ hasText: "Close your current editor" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/live");
  assert.equal(await page.getByRole("dialog").getByLabel("Delivery notes", { exact: true }).inputValue(), "Human work must stay here");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await call("navigate", "allowed-navigation");
  await page.waitForURL("**/pipeline");
  toolHandler = async () => ({ finish: true });
  const beforeFinish = endCalls;
  await call("finish_conversation", "finish-one");
  await page.waitForFunction(() => window.fixtureVoice.sent.some(e => e.response?.metadata?.gud_finish));
  const marker = await page.evaluate(() => window.fixtureVoice.sent.findLast(e => e.response?.metadata?.gud_finish).response.metadata.gud_finish);
  await emit({ type: "output_audio_buffer.stopped", response_id: "previous-response" });
  assert.equal(endCalls, beforeFinish);
  await emit({ type: "response.created", response: { id: "sign-off", metadata: { gud_finish: marker } } });
  await emit({ type: "response.done", response: { id: "sign-off", status: "completed", metadata: { gud_finish: marker }, output: [] } });
  assert.equal(endCalls, beforeFinish);
  await emit({ type: "output_audio_buffer.stopped", response_id: "sign-off" });
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  assert.equal(endCalls, beforeFinish+1);
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.at(-1).stopped), true);

  // End must stop the mic immediately, not after a delayed tool response. A
  // privately staged draft is recovered, but its stale navigation is suppressed.
  let releaseTool;
  const delayed = new Promise(resolve => { releaseTool = resolve; });
  toolHandler = async () => { await delayed; const draft = makeDraft("Recovered after End"); drafts = [draft]; return { draft, navigate: "/thoughts" }; };
  await startVoice();
  const beforeDelayed = toolCalls;
  await call("stage_change", "delayed-one");
  await expect.poll(() => toolCalls).toBe(beforeDelayed+1);
  const urlBeforeEnd = page.url();
  await panel.getByRole("button", { name: "End", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.at(-1).stopped), true);
  releaseTool();
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  await panel.getByRole("region", { name: "Draft Recovered after End" }).waitFor();
  assert.equal(page.url(), urlBeforeEnd);
  assert.equal(await page.evaluate(() => window.fixtureVoice.sent.some(e => e.item?.call_id === "delayed-one")), false);

  // Reopening restores drafts. A failed second manual edit must not make the
  // successfully updated first draft stale or lose either user's text.
  await panel.getByRole("button", { name: "Close conversation", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  drafts = [makeDraft("First thought"), makeDraft("Second thought")];
  failEditId = drafts[1].id;
  saveCheck = () => { assert.equal(drafts[0].fields.title, "First manually edited"); assert.equal(drafts[1].fields.title, "Second manually edited"); assert.deepEqual(drafts.map(d => d.version), [2, 2]); };
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await startVoice();
  await panel.getByRole("region", { name: "Draft First thought" }).getByLabel("Title", { exact: true }).fill("First manually edited");
  await panel.getByRole("region", { name: "Draft Second thought" }).getByLabel("Title", { exact: true }).fill("Second manually edited");
  await panel.getByRole("button", { name: "Save all 2 drafts", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture edit interrupted" }).waitFor();
  await panel.getByRole("button", { name: "Save all 2 drafts", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("All Gud · saved");
  assert.equal(saves, 3);
  await panel.getByRole("button", { name: "Resume mic", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.at(-1).enabled), false);
  const beforePaused = toolCalls;
  await call("stage_change", "late-after-save");
  await page.waitForFunction(() => window.fixtureVoice.sent.some(e => e.item?.call_id === "late-after-save"));
  assert.equal(toolCalls, beforePaused);
  await panel.getByRole("button", { name: "Resume mic", exact: true }).click();
  toolHandler = async () => ({ navigate: "/live" });
  await emit({ type: "response.done", response: { status: "cancelled", output: [{ type: "function_call", name: "navigate", arguments: "{}", call_id: "cancelled" }] } });
  await call("navigate", "resumed");
  await page.waitForURL("**/live");
  assert.equal(toolCalls, beforePaused+1);
  await panel.getByRole("button", { name: "End", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Conversation ended");

  // Transport loss closes the provider session too, then permits a fresh call.
  await startVoice();
  const beforeDisconnect = endCalls;
  await page.evaluate(() => { const p = window.fixtureVoice.peers.at(-1); p.connectionState = "disconnected"; p.onconnectionstatechange(); });
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  assert.equal(endCalls, beforeDisconnect+1);
  await startVoice();
  await panel.getByRole("button", { name: "Close conversation", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.every(t => t.stopped)), true);
  // Opt-out survives a reload; direct launch is enabled only by the user's
  // setting and click, never by mounting the panel or visiting another page.
  await page.reload();
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await panel.getByRole("button", { name: "Start conversation", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.length), 0);
  await panel.getByRole("button", { name: "Options", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "Conversation first", exact: true })).not.toBeChecked();
  await expect(panel.getByLabel("GUD voice", { exact: true })).toHaveValue("cedar");
  await panel.getByRole("checkbox", { name: "Conversation first", exact: true }).check();
  await page.reload();
  const launchesBefore = operations.filter(op => op === "start").length;
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.length), 0);
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).dblclick();
  await panel.getByRole("button", { name: "Mute", exact: true }).waitFor();
  assert.equal(operations.filter(op => op === "start").length, launchesBefore+1);
  assert.equal(voiceRequests.at(-1).voice, "cedar");
  await panel.getByRole("button", { name: "End", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  // Cancel while the browser is still showing a microphone permission prompt.
  const connectionsBefore = voiceRequests.length;
  await page.evaluate(() => { window.fixtureVoice.deferMicrophone = true; });
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await page.waitForFunction(() => typeof window.fixtureVoice.allowMicrophone === "function");
  await panel.getByRole("button", { name: "End", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Conversation ended");
  await page.evaluate(() => window.fixtureVoice.allowMicrophone());
  await page.waitForFunction(() => window.fixtureVoice.tracks.length === 2 && window.fixtureVoice.tracks.at(-1).stopped);
  assert.equal(voiceRequests.length, connectionsBefore);
  await panel.getByRole("button", { name: "Options", exact: true }).click();
  await panel.getByRole("button", { name: "Ask my permission again next time", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Talk to GUD", exact: true }).click();
  await panel.getByRole("checkbox", { name: /Allow my conversation/ }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureVoice.tracks.length), 0);
  assert.deepEqual(errors, []);
  console.log("Conversation browser checks passed: consent/revocation, parallel voice preparation, remembered voice choice, conversation-first/default/opt-out, no automatic page-load microphone, duplicate-launch guard, late microphone cancellation, draft/edit, blank-value guard, route persistence, manual-editor protection, failed-save honesty, partial-edit retry, final audio drain, immediate mic stop, late-tool recovery, save/mic pause, cancelled-response rejection, reconnect, All Gud sign-off and mobile fit.");
} finally { await browser.close(); }
