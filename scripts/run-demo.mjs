import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const edition = process.argv[2];
if (!new Set(["focused", "service"]).has(edition)) {
  throw new Error("Choose a demo mode: focused or service.");
}

const root = process.cwd();
const defaultPort = edition === "focused" ? 3200 : 3201;
const port = Number(process.env.PORT ?? defaultPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT must be an integer between 1024 and 65535.");
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_BACKEND: "demo",
    GUD_DEFAULT_MODEL: edition,
    GUD_INSTANCE_NAME: edition === "focused" ? "Focused Sales demo" : "Service Sales demo",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    NEXT_DIST_DIR: `.next-demo-${edition}`,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
