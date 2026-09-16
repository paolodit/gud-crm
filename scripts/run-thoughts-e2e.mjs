// The AI browser test only talks to this loopback fixture, never a paid provider.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
const provider = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/responses") { response.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const note = JSON.parse(input.input[1].content);
  if (input.store !== false || Object.keys(note).sort().join(",") !== "checklist,text,title") { response.writeHead(400).end(); return; }
  if (note.text.includes("fixture failure")) { response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "PRIVATE PROVIDER ERROR must not be shown" } })); return; }
  const researched = input.tools.some((tool) => tool.type === "web_search");
  const text = researched ? "## Research\nA sourced observation [1]\n\n## Options\nTry a small experiment." : "## Understanding\nA small experiment could help.\n\n## Research\nNo web research was requested.";
  const index = text.indexOf("[1]");
  const annotations = researched ? [{ type: "url_citation", url: "https://example.com/research", title: "Fixture research source", start_index: index, end_index: index + 3 }] : [];
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "resp_thoughts_fixture", object: "response", status: "completed", model: input.model, output: [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const address = provider.address();
if (!address || typeof address === "string") throw new Error("Thoughts fixture could not start.");
const runner = spawn(process.execPath, [path.join(process.cwd(), "scripts/run-e2e.mjs"), "tests/e2e/thoughts-ai.spec.ts"], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, GUD_THOUGHT_AI_FIXTURE: "true", GUD_PUBLIC_DEMO: "false", AI_ENABLED: "true", AI_PROVIDER: "openai", AI_MODEL: "test-model", AI_RATE_LIMIT: "30", OPENAI_API_KEY: "test-placeholder", OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
});
try { process.exitCode = await new Promise((resolve) => runner.once("exit", (code) => resolve(code ?? 1))); }
finally { await new Promise((resolve) => provider.close(resolve)); }
