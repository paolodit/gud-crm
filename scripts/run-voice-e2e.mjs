// Isolated browser tests: a loopback-only OpenAI fixture, never a live provider.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

const provider = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/responses") { response.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const { reference, transcript } = JSON.parse(body.input[1].content);
  if (transcript.includes("provider failure")) { response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Fixture provider failure", type: "invalid_request_error" } })); return; }
  const draft = Object.fromEntries(Object.keys(body.text.format.schema.properties).map((key) => [key, null]));
  if (transcript.includes("two clients")) draft.clarification = "Please choose one client for this update.";
  else if (reference.selected.kind === "direct" || reference.selected.kind === "delivery") {
    Object.assign(draft, { deliveryStage: reference.deliveryStages.find((stage) => stage.name === "In progress").id, deliveryValue: 12500.5, milestone: "Send the first draft", milestoneDate: "2026-10-16", deliveryNote: "The client approved the design." });
  } else {
    const noteType = reference.activityTypes.find((type) => type.name === "Other activity / note") ?? reference.activityTypes.find((type) => type.channel === "note");
    Object.assign(draft, { salesValue: 12500.5, temperature: "warm", activity: { typeId: noteType.id, notes: "The client approved the outline.", outcome: "Approved", occurredLocal: null }, task: { title: "Send the proposal", dueDate: "2026-10-16", dueTime: transcript.includes("missing time") ? null : "10:00" } });
  }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "resp_test", object: "response", status: "completed", model: body.model, output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(draft), annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const address = provider.address();
if (!address || typeof address === "string") throw new Error("Fixture provider failed to start");
const runner = spawn(process.execPath, [path.join(process.cwd(), "scripts/run-e2e.mjs"), "tests/e2e/workspace-voice.spec.ts", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, AI_ENABLED: "true", AI_PROVIDER: "openai", AI_MODEL: "test-model", AI_RATE_LIMIT: "30", OPENAI_API_KEY: "test-placeholder", OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
});
try { process.exitCode = await new Promise((resolve) => runner.once("exit", (code) => resolve(code ?? 1))); }
finally { await new Promise((resolve) => provider.close(resolve)); }
