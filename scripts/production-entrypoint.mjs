import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const backend = process.env.DATA_BACKEND ?? (process.env.DATABASE_URL ? "postgres" : "sqlite");
const bootstrapMode = process.env.GUD_BOOTSTRAP ?? "off";

if (!["off", "if-empty"].includes(bootstrapMode)) {
  throw new Error("GUD_BOOTSTRAP must be either off or if-empty.");
}
if (bootstrapMode !== "off" && backend !== "postgres") {
  throw new Error("GUD_BOOTSTRAP is available only with DATA_BACKEND=postgres.");
}

if (backend === "postgres") {
  await runUtility("migrate-production.cjs");
  if (bootstrapMode === "if-empty") {
    validateBootstrapEnvironment();
    await runUtility("seed-production.cjs", { SEED_IF_EMPTY: "true" });
  }
}

const server = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

async function runUtility(fileName, extraEnvironment = {}) {
  const child = spawn(process.execPath, [path.join(root, fileName)], {
    cwd: root,
    env: { ...process.env, ...extraEnvironment },
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`${fileName} stopped with exit code ${code ?? "unknown"}.`);
}

function validateBootstrapEnvironment() {
  const required = ["SEED_ORGANISATION_NAME", "SEED_ADMIN_NAME", "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`GUD_BOOTSTRAP=if-empty requires: ${missing.join(", ")}.`);
  if ((process.env.SEED_ADMIN_PASSWORD?.length ?? 0) < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must contain at least 12 characters.");
  }
  if (/@(?:example\.(?:com|org|net)|[^@]+\.example)$/i.test(process.env.SEED_ADMIN_EMAIL ?? "")) {
    throw new Error("SEED_ADMIN_EMAIL must be a real administrator address, not an example domain.");
  }
}
