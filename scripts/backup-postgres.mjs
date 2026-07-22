import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const backupDir = process.env.GUD_BACKUP_DIR;
const retention = Number(process.env.GUD_BACKUP_RETENTION ?? 21);
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!backupDir) throw new Error("GUD_BACKUP_DIR is required and should be an encrypted, off-app backup mount.");
if (!Number.isInteger(retention) || retention < 3 || retention > 365) throw new Error("GUD_BACKUP_RETENTION must be between 3 and 365.");

const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!databaseName) throw new Error("DATABASE_URL must include a database name.");
const safeDatabaseName = databaseName.replace(/[^a-zA-Z0-9_-]/g, "-");
const stamp = new Date().toISOString().replaceAll(":", "-");
const baseName = `${safeDatabaseName}-${stamp}.dump`;
const finalPath = path.resolve(backupDir, baseName);
const temporaryPath = `${finalPath}.partial`;
if (!finalPath.startsWith(`${path.resolve(backupDir)}${path.sep}`)) throw new Error("Backup path escaped the configured directory.");

await mkdir(path.dirname(finalPath), { recursive: true });
await runPgDump(parsed, databaseName, temporaryPath);
await rename(temporaryPath, finalPath);
const checksum = await sha256(finalPath);
const details = await stat(finalPath);
await writeFile(`${finalPath}.sha256`, `${checksum}  ${baseName}\n`, { encoding: "utf8", flag: "wx" });
await pruneBackups(path.resolve(backupDir), safeDatabaseName, retention);
process.stdout.write(JSON.stringify({ ok: true, database: safeDatabaseName, file: finalPath, bytes: details.size, sha256: checksum, completedAt: new Date().toISOString() }) + "\n");

function runPgDump(url, dbName, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PG_DUMP_BIN ?? "pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", destination, dbName], {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
      },
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}.`)));
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function pruneBackups(directory, database, keep) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${database}-`) && entry.name.endsWith(".dump"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of entries.slice(keep)) {
    const file = path.join(directory, name);
    await rm(file, { force: true });
    await rm(`${file}.sha256`, { force: true });
  }
}
