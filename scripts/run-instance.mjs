import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const root = process.cwd();
const configPath = path.resolve(root, process.env.GUD_INSTANCES_FILE ?? "config/instances.local.json");
const alias = process.argv[2];

if (!existsSync(configPath)) {
  throw new Error("Create config/instances.local.json from config/instances.example.json. The local file is ignored by Git.");
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const instance = alias ? config.instances?.[alias] : null;
if (!instance) {
  const available = Object.keys(config.instances ?? {}).join(", ") || "none";
  throw new Error(`Choose an instance: npm run dev:instance -- <name>. Available: ${available}`);
}
if (!["focused", "service"].includes(instance.model)) throw new Error("Instance model must be focused or service.");
if (!Number.isInteger(instance.port) || instance.port < 1024 || instance.port > 65535) throw new Error("Instance port must be an integer between 1024 and 65535.");
if (typeof instance.database !== "string" || !instance.database.trim()) throw new Error("Instance database path is required.");

const dataRoot = path.resolve(root, "data");
const databasePath = path.resolve(root, instance.database);
const relativeDatabasePath = path.relative(dataRoot, databasePath);
if (relativeDatabasePath.startsWith("..") || path.isAbsolute(relativeDatabasePath)) {
  throw new Error("Private instance databases must live under the ignored data/ directory.");
}
if (![".db", ".sqlite", ".sqlite3"].includes(path.extname(databasePath).toLowerCase())) {
  throw new Error("Instance database must use a .db, .sqlite or .sqlite3 extension.");
}

const configuredInstances = Object.entries(config.instances ?? {});
const duplicatePort = configuredInstances.find(([name, candidate]) => name !== alias && candidate?.port === instance.port);
if (duplicatePort) throw new Error(`Port ${instance.port} is also assigned to ${duplicatePort[0]}.`);
const duplicateDatabase = configuredInstances.find(([name, candidate]) =>
  name !== alias && typeof candidate?.database === "string" && path.resolve(root, candidate.database) === databasePath,
);
if (duplicateDatabase) throw new Error(`Database ${instance.database} is also assigned to ${duplicateDatabase[0]}.`);

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(instance.port)], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_BACKEND: "sqlite",
    SQLITE_PATH: path.relative(root, databasePath),
    GUD_DEFAULT_MODEL: instance.model,
    GUD_INSTANCE_NAME: instance.label,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${instance.port}`,
    BETTER_AUTH_URL: `http://127.0.0.1:${instance.port}`,
    NEXT_DIST_DIR: ".next-instance",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
