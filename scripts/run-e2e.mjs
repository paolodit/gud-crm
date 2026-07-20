import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const root = process.cwd();

for (const suffix of ["", "-shm", "-wal"]) rmSync(path.join(root, `data/gud-e2e.db${suffix}`), { force: true });

const server = spawn(process.execPath, [
  path.join(root, "node_modules/next/dist/bin/next"),
  "dev",
  "--hostname", "127.0.0.1",
  "--port", String(port),
], {
  cwd: root,
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    DATA_BACKEND: "sqlite",
    SQLITE_PATH: "data/gud-e2e.db",
    GUD_DEFAULT_MODEL: "service",
    NEXT_PUBLIC_APP_URL: baseURL,
    BETTER_AUTH_URL: baseURL,
    NEXT_DIST_DIR: ".next-e2e",
  },
  stdio: "inherit",
});

let exitCode = 1;
try {
  await waitForServer();
  const runner = spawn(process.execPath, [
    path.join(root, "node_modules/@playwright/test/cli.js"),
    "test",
    ...process.argv.slice(2),
  ], { cwd: root, env: process.env, stdio: "inherit" });
  exitCode = await new Promise((resolve) => runner.once("exit", (code) => resolve(code ?? 1)));
} finally {
  stopServerTree();
}
await new Promise((resolve) => setTimeout(resolve, 250));
process.exit(exitCode);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`The E2E server stopped with exit code ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The E2E server did not become healthy within 60 seconds.");
}

function stopServerTree() {
  if (!server.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { detached: true, stdio: "ignore", windowsHide: true });
    killer.unref();
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The server already stopped.
    }
  }
}
