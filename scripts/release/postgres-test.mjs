// CI-only, disposable database. Never accepts the ordinary production DATABASE_URL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { verifySnapshot } from "./core.mjs";

const databaseUrl = process.env.GUD_RELEASE_TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_release_test")) {
  throw new Error("GUD_RELEASE_TEST_DATABASE_URL must point to a disposable database ending in _release_test.");
}
const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "gud-release-test-"));
const baseline = path.join(temporary, "baseline");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const childEnv = { ...process.env, DATABASE_URL: databaseUrl, GUD_BOOTSTRAP: "off", DATA_BACKEND: "postgres", GUD_RELEASE_GUARDED: "true" };

async function execute(file, extraEnv = {}, input) {
  return new Promise((resolve, reject) => {
    const args = file ? [file] : ["--input-type=module"];
    const child = spawn(process.execPath, args, { cwd: root, env: { ...childEnv, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || "Fixture command failed.")));
  });
}
const migrator = path.join(root, ".next/standalone/migrate-production.cjs");

try {
  const existing = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle')");
  assert.equal(existing.rows[0].count, 0, "Fixture database must be empty; this test never resets existing data.");
  await assert.rejects(execute(migrator), /empty database/);
  await cp(path.join(root, "drizzle"), baseline, { recursive: true });
  const journalFile = path.join(baseline, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalFile, "utf8"));
  journal.entries.pop();
  await writeFile(journalFile, JSON.stringify(journal));
  await execute(migrator, { GUD_MIGRATIONS_DIR: baseline, GUD_RELEASE_GUARDED: "false" });
  const orgId = "80000000-0000-4000-8000-000000000001";
  const settings = { directProjects: [{ id: "private-project", title: "Keep this project", delivery: { tasks: [{ id: "private-task", text: "Keep this task" }] } }] };
  await pool.query("INSERT INTO organisations (id, name, settings) VALUES ($1, $2, $3)", [orgId, "Existing business", settings]);
  await pool.query("INSERT INTO users (id, organisation_id, name, email) VALUES ($1, $2, $3, $4)", ["existing-user", orgId, "Existing user", "release@example.com"]);
  await pool.query("INSERT INTO companies (organisation_id, name, normalised_name) VALUES ($1, $2, $3)", [orgId, "Keep this company", "keep this company"]);
  const probeSource = await readFile(path.join(root, "scripts/release/probe.mjs"));
  const before = JSON.parse(await execute(null, {}, probeSource));
  const recordsBefore = (await pool.query("SELECT to_jsonb(o) AS value FROM organisations o")).rows;
  // Two overlapping starts must serialize, not race or apply the same migration twice.
  await Promise.all([execute(migrator), execute(migrator)]);
  await execute(migrator);
  // An older image's migration set can still start, without attempting a schema downgrade.
  await execute(migrator, { GUD_MIGRATIONS_DIR: baseline });
  const after = JSON.parse(await execute(null, {}, probeSource));
  verifySnapshot(after, readMigrationFiles({ migrationsFolder: path.join(root, "drizzle") }), before);
  assert.deepEqual((await pool.query("SELECT to_jsonb(o) AS value FROM organisations o")).rows, recordsBefore);
  assert.equal(after.keys.companies.length, 1);
  assert.equal(after.keys.direct_projects.length, 1);
  assert.equal(after.keys.delivery_checklist.length, 1);
  const counts = await pool.query("SELECT count(*)::int AS total, count(DISTINCT hash)::int AS unique FROM drizzle.__drizzle_migrations");
  assert.equal(counts.rows[0].total, counts.rows[0].unique);
  // A failed migration remains transactional and cannot delete or rewrite existing data.
  const broken = path.join(temporary, "broken");
  await cp(path.join(root, "drizzle"), broken, { recursive: true });
  const brokenJournal = JSON.parse(await readFile(path.join(broken, "meta/_journal.json"), "utf8"));
  const previous = brokenJournal.entries.at(-1);
  brokenJournal.entries.push({ ...previous, idx: previous.idx + 1, when: previous.when + 1, tag: "9999_failed_fixture" });
  await writeFile(path.join(broken, "meta/_journal.json"), JSON.stringify(brokenJournal));
  await writeFile(path.join(broken, "9999_failed_fixture.sql"), "CREATE TABLE release_should_rollback (id int);--> statement-breakpoint\nALTER TABLE missing_fixture_table ADD value text;");
  await assert.rejects(execute(migrator, { GUD_MIGRATIONS_DIR: broken }));
  assert.equal((await pool.query("SELECT to_regclass('public.release_should_rollback') AS name")).rows[0].name, null);
  assert.deepEqual((await pool.query("SELECT to_jsonb(o) AS value FROM organisations o")).rows, recordsBefore);
  console.log("PostgreSQL upgrade, concurrent/repeat migrations, rollback-on-failure and existing records verified.");
} finally {
  await pool.end();
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(temporary).startsWith(tempRoot)) throw new Error("Unexpected fixture path; refusing cleanup.");
  await rm(temporary, { recursive: true, force: true });
}
