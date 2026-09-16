import { spawn } from "node:child_process";
import { createReadStream, constants } from "node:fs";
import { copyFile, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { inspectTarget, registryRepository, releaseHealth, rollout, snapshotCounts, validateConfig, verifySnapshot, digest } from "./release/core.mjs";
import { loadSettings, mergeSettings, settingsPath } from "./release/settings.mjs";
import { assertQuietWindow, assertServiceStable, deployImage, verifyAppToken } from "./release/caprover.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const mode = argv.shift();
if (!["plan", "apply"].includes(mode) || (argv.length && (argv.length !== 2 || argv[0] !== "--ref"))) {
  console.error("Usage: npm run release:plan | npm run release:all -- --ref <commit>");
  process.exit(1);
}
const ref = argv[1] ?? "HEAD";
if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.,-]*$/.test(ref)) throw new Error("Invalid Git reference.");
const config = validateConfig(JSON.parse(await readFile(path.join(root, "config/rollout.json"), "utf8")));

// Commands receive secrets through their environment or stdin, never shell interpolation/argv.
async function run(command, args, { input, inputFile, outputFile, env, timeout = 120000, visible = false } = {}) {
  const output = outputFile ? await open(outputFile, "wx", 0o600) : null;
  let child;
  try {
    child = spawn(command, args, { cwd: root, env: env ?? process.env, shell: false,
      stdio: ["pipe", output ? output.fd : visible ? "inherit" : "pipe", visible ? "inherit" : "pipe"] });
    let bytes = 0;
    const chunks = [];
    child.stdout?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 100 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr?.resume(); // May contain provider errors/connection details. Never echo it.
    const completed = new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error(`${command} could not start. Check the runner installation.`)));
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed. Check the private runner/server diagnostics.`)));
    });
    const timer = setTimeout(() => child.kill(), timeout);
    try {
      const supplied = inputFile
        ? pipeline(createReadStream(inputFile), child.stdin)
        : new Promise((resolve) => { child.stdin.on("error", () => undefined); child.stdin.end(input ?? "", resolve); });
      await Promise.all([completed, supplied]);
      await output?.sync();
      return Buffer.concat(chunks).toString("utf8").trim();
    } finally { clearTimeout(timer); }
  } finally { child?.kill(); await output?.close(); }
}

const git = (args, options) => run("git", args, options);
const docker = (args, options) => run("docker", args, options);
const jsonDocker = async (args) => JSON.parse(await docker(args));
const fileHash = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lock, lockPath, journalPath, journal;
try {
  const revision = await git(["rev-parse", "--verify", `${ref}^{commit}`]);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full Git commit is required.");
  const migrationJournal = JSON.parse(await git(["show", `${revision}:drizzle/meta/_journal.json`]));
  const migrations = [];
  for (const entry of migrationJournal.entries) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("Invalid migration journal.");
    // Hash raw bytes, including the final newline, exactly as Drizzle does in the image.
    const sql = await gitRaw(`${revision}:drizzle/${entry.tag}.sql`);
    migrations.push({ hash: digest(sql), folderMillis: entry.when, sql: sql.split("--> statement-breakpoint") });
  }
  console.log(`Release ${revision}\nSame image → ${config.targets.map((target) => target.app).join(" → ")}\nExisting PostgreSQL data retained; no reset, seed or volume changes.`);
  if (mode === "plan") {
    const dirty = await git(["status", "--porcelain"]);
    console.log(`${migrations.length} committed migrations; live pending migrations are checked on the server.`);
    console.log(dirty ? "Working tree changes exist. They are NOT part of this commit or release." : "Working tree is clean.");
    console.log("Plan only: no server access, backup, build, push or deployment performed.");
  } else {
    if (process.platform !== "linux") throw new Error("Run release:all on the trusted Linux CapRover manager, not a developer computer.");
    try { mergeSettings(process.env, await loadSettings(settingsPath)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const remoteRepository = registryRepository(process.env.GUD_RELEASE_IMAGE_REPOSITORY);
    if (await git(["rev-parse", "HEAD"]) !== revision || await git(["status", "--porcelain", "--untracked-files=no"])) {
      throw new Error("Use a clean checkout of the exact release commit on the server.");
    }
    // Ensure this command itself is from the release, not an untracked replacement.
    for (const file of ["scripts/release-all.mjs", "scripts/release/core.mjs", "scripts/release/probe.mjs", "scripts/release/settings.mjs", "scripts/release/caprover.mjs", "src/lib/deployment/migrations.ts", "config/rollout.json"]) {
      if (digest(await readFile(path.join(root, file), "utf8")) !== digest(await gitRaw(`${revision}:${file}`))) {
        throw new Error("Release tooling must match the selected commit exactly.");
      }
    }
    const files = (await git(["ls-tree", "-r", "--name-only", revision])).split("\n");
    if (files.some((file) => /^(?:data\/|\.codex|config\/caprover\.local\.|config\/instances\.local\.json|\.env(?:\.|$)(?!example$))|\.(?:dump|sqlite3?|db|ppk|pem|xlsx?|csv)$/i.test(file))) {
      throw new Error("The commit contains a private/runtime file path. Audit the release before packaging.");
    }
    for (const target of config.targets) {
      if (!process.env[target.tokenEnv]?.trim()) throw new Error(`${target.tokenEnv} is required on the runner.`);
    }
    const directories = {};
    for (const [key, envName] of Object.entries({ state: "GUD_RELEASE_STATE_DIR", backup: "GUD_RELEASE_BACKUP_DIR", copy: "GUD_RELEASE_BACKUP_COPY_DIR" })) {
      const value = process.env[envName];
      if (!value || !path.isAbsolute(value)) throw new Error(`${envName} must name an existing private absolute directory.`);
      directories[key] = await realpath(value);
      const directoryStat = await stat(directories[key]);
      if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077)) throw new Error(`${envName} must be a private directory (mode 0700).`);
      if (directories[key] === root || directories[key].startsWith(root + path.sep)) throw new Error("Release state and backups must be outside the source checkout.");
    }
    const paths = Object.values(directories);
    if (paths.some((a, i) => paths.some((b, j) => i !== j && (a === b || a.startsWith(b + path.sep))))) {
      throw new Error("State, primary backups and backup copies must be separate, non-nested directories.");
    }
    if (!process.stdin.isTTY) throw new Error("Run interactively: app tokens cannot read CapRover's queued-build status.");
    console.log("In CapRover, verify no builds are queued/running. Do not start manual deployments until this rollout finishes.");
    const confirmation = createInterface({ input: process.stdin, output: process.stdout });
    try { assertQuietWindow(await confirmation.question("Confirm CapRover is idle and this is the only deployment operator (type yes): ")); }
    finally { confirmation.close(); }
    // One shared lock for these apps, regardless of which Git checkout launched the command.
    lockPath = path.join(directories.state, "rollout.lock");
    lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("A rollout lock exists. Check the previous release before removing a stale lock manually."); });
    await lock.writeFile(JSON.stringify({ pid: process.pid, revision, startedAt: new Date().toISOString() }));
    const nodes = (await docker(["node", "ls", "--format", "{{.ID}}"])).split("\n").filter(Boolean);
    if (nodes.length !== 1) throw new Error("This database-backup adapter requires a single-node CapRover swarm. Multi-node installations need a remote backup adapter.");
    const releaseId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${revision.slice(0, 12)}`;
    const releaseDir = path.join(directories.state, releaseId);
    await mkdir(releaseDir, { mode: 0o700 });
    journalPath = path.join(releaseDir, "release.json");
    journal = { releaseId, revision, status: "running", startedAt: new Date().toISOString(), targets: {} };
    const record = async (id, update) => {
      journal.targets[id] = { ...journal.targets[id], ...update };
      await saveJournal();
    };
    const probeSource = await readFile(path.join(root, "scripts/release/probe.mjs"));
    const assertReady = async (target) => {
      await verifyAppToken(config.captainUrl, target.app, process.env[target.tokenEnv]);
      assertServiceStable(await service(target));
    };
    const pushImage = async (tag) => {
      await docker(["image", "push", tag], { timeout: 15 * 60 * 1000 });
      const image = (await jsonDocker(["image", "inspect", tag]))[0];
      const pinned = image.RepoDigests?.find((entry) => entry.startsWith(`${remoteRepository}@sha256:`));
      if (!pinned || !/^[a-f0-9]{64}$/.test(pinned.split("@sha256:")[1])) throw new Error("Registry did not provide an immutable image digest.");
      return pinned;
    };
    const service = async (target) => (await jsonDocker(["service", "inspect", `srv-captain--${target.app}`]))[0];
    const containerId = async (serviceName) => {
      const ids = (await docker(["ps", "--filter", `label=com.docker.swarm.service.name=${serviceName}`, "--filter", "status=running", "--format", "{{.ID}}"]))?.split("\n").filter(Boolean);
      if (ids.length !== 1) throw new Error("Expected exactly one running local service container; wait for any existing deployment to finish.");
      return ids[0];
    };
    const probe = async (instance) => JSON.parse(await docker(["exec", "-i", await containerId(`srv-captain--${instance.target.app}`), "node", "--input-type=module"], { input: probeSource }));
    const assertUnchanged = async (instance) => {
      await assertReady(instance.target);
      const current = inspectTarget(instance.target, await service(instance.target));
      if (current.configurationIdentity !== instance.configurationIdentity || current.previousImage !== instance.previousImage) {
        throw new Error(`${instance.target.id}: app configuration/image changed during this release. Stop for review.`);
      }
    };
    await rollout(config.targets, {
      async preflight(target) {
        console.log(`${target.id}: checking existing app, database and migration history.`);
        await assertReady(target);
        const instance = inspectTarget(target, await service(target));
        instance.databaseContainer = await containerId(instance.database.hostname);
        const dbService = (await jsonDocker(["service", "inspect", instance.database.hostname]))[0];
        if (!(dbService.Spec.TaskTemplate.ContainerSpec.Mounts ?? []).length) throw new Error(`${target.id}: database has no persistent mount.`);
        instance.before = await probe(instance);
        const pending = verifySnapshot(instance.before, migrations);
        const old = (await jsonDocker(["image", "inspect", instance.previousImage]))[0];
        instance.rollbackImage = `${remoteRepository}:rollback-${target.id}-${releaseId.toLowerCase()}`;
        instance.oldImageId = old.Id;
        await record(target.id, { phase: "preflight", previousImage: instance.previousImage, rollbackImage: instance.rollbackImage,
          databaseIdentity: instance.databaseIdentity, pendingMigrations: pending, beforeCounts: snapshotCounts(instance.before) });
        return instance;
      },
      async build() {
        const tag = `${config.imageRepository}:${revision}`;
        const existing = await docker(["image", "ls", "--quiet", "--no-trunc", tag]);
        if (!existing) {
          console.log("Building and testing one committed release image (no production credentials in the build).");
          const archive = path.join(releaseDir, "source.tar");
          await git(["archive", "--format=tar", revision], { outputFile: archive });
          await docker(["build", "--tag", tag, "--build-arg", `GUD_BUILD_REVISION=${revision}`, "--build-arg", "GUD_RELEASE_GUARDED=true", "-"], {
            inputFile: archive, timeout: 30 * 60 * 1000, visible: true,
          });
        }
        const image = (await jsonDocker(["image", "inspect", tag]))[0];
        if (image.Config.Labels?.["org.opencontainers.image.revision"] !== revision || image.Config.Labels?.["com.gud.guarded-release"] !== "true") {
          throw new Error("Release image metadata does not match this guarded commit.");
        }
        const remoteTag = `${remoteRepository}:${revision}`;
        console.log("Publishing the shared image and pinning its registry digest.");
        await docker(["image", "tag", image.Id, remoteTag]);
        const reference = await pushImage(remoteTag);
        journal.image = { tag: remoteTag, reference, id: image.Id };
        await saveJournal();
        return journal.image;
      },
      async backup(instance) {
        const { target, database } = instance;
        await assertUnchanged(instance);
        await docker(["image", "tag", instance.oldImageId, instance.rollbackImage]);
        instance.rollbackImage = await pushImage(instance.rollbackImage);
        console.log(`${target.id}: creating and checking a full database backup and second copy.`);
        const filename = `${releaseId}-${target.id}.dump`;
        const destination = path.join(directories.backup, filename);
        const partial = `${destination}.partial`;
        const env = { ...process.env, PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: decodeURIComponent(database.username),
          PGPASSWORD: decodeURIComponent(database.password), PGDATABASE: decodeURIComponent(database.pathname.slice(1)) };
        await docker(["exec", "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE",
          instance.databaseContainer, "pg_dump", "--format=custom", "--no-owner", "--no-acl"], { env, outputFile: partial, timeout: 15 * 60 * 1000 });
        const handle = await open(partial, "r");
        try {
          const magic = Buffer.alloc(5);
          await handle.read(magic, 0, 5, 0);
          if (magic.toString() !== "PGDMP" || (await handle.stat()).size < 100) throw new Error("Database backup is empty or invalid.");
        } finally { await handle.close(); }
        const listing = await docker(["exec", "-i", instance.databaseContainer, "pg_restore", "--list"], { inputFile: partial });
        if (!listing.includes("__drizzle_migrations") || !listing.includes("organisations")) throw new Error("Backup lacks application or migration history tables.");
        await rename(partial, destination);
        const checksum = await fileHash(destination);
        const copy = path.join(directories.copy, filename);
        await copyFile(destination, `${copy}.partial`, constants.COPYFILE_EXCL);
        if (await fileHash(`${copy}.partial`) !== checksum) throw new Error("The second backup copy failed checksum verification.");
        await rename(`${copy}.partial`, copy);
        for (const file of [destination, copy]) await writeFile(`${file}.sha256`, `${checksum}  ${filename}\n`, { flag: "wx", mode: 0o600 });
        await record(target.id, { phase: "backed-up", rollbackImage: instance.rollbackImage, backup: { path: destination, copy, sha256: checksum, bytes: (await stat(destination)).size } });
      },
      assertUnchanged,
      async deploy(instance, image) {
        // Last-minute history check; a separate schema change must not slip through the preflight.
        const latest = await probe(instance);
        verifySnapshot(latest, migrations);
        if (JSON.stringify(latest.migrations) !== JSON.stringify(instance.before.migrations)) throw new Error("Migration history changed during release; stop for review.");
        instance.before = latest;
        console.log(`${instance.target.id}: deploying the shared image; pending migrations run before startup.`);
        await record(instance.target.id, { phase: "deploy-requested", beforeCounts: snapshotCounts(latest) });
        await deployImage(config.captainUrl, instance.target.app, process.env[instance.target.tokenEnv], { captainDefinitionContent: JSON.stringify({ schemaVersion: 2, imageName: image.reference }), gitHash: revision });
      },
      async verify(instance, image) {
        const deadline = Date.now() + 15 * 60 * 1000;
        let consecutive = 0;
        while (Date.now() < deadline && consecutive < 3) {
          await sleep(5000);
          try {
            const current = inspectTarget(instance.target, await service(instance.target));
            if (current.configurationIdentity !== instance.configurationIdentity) throw new Error("Configuration changed.");
            const container = (await jsonDocker(["container", "inspect", await containerId(`srv-captain--${instance.target.app}`)]))[0];
            const response = await fetch(`${instance.origin}/api/health`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
            const healthy = response.ok && releaseHealth(await response.json(), revision);
            consecutive = healthy && container.Image === image.id && container.State.Health?.Status === "healthy" ? consecutive + 1 : 0;
          } catch { consecutive = 0; }
        }
        if (consecutive < 3) throw new Error(`${instance.target.id}: the new image did not become healthy. Remaining instances have not been deployed.`);
        const after = await probe(instance);
        verifySnapshot(after, migrations, instance.before);
        await record(instance.target.id, { phase: "verified", afterCounts: snapshotCounts(after), verifiedAt: new Date().toISOString() });
        console.log(`${instance.target.id}: new version healthy, migrations current, existing record IDs retained.`);
      },
    });
    journal.status = "complete";
    journal.finishedAt = new Date().toISOString();
    await saveJournal();
    console.log(`All three instances verified. Release record: ${journalPath}\nBackups and rollback image tags retained. Nothing has been pruned.`);
  }
} catch (error) {
  if (journal) { journal.status = "stopped"; journal.finishedAt = new Date().toISOString(); await saveJournal().catch(() => undefined); }
  console.error(error instanceof Error ? error.message : "Rollout stopped.");
  if (journalPath) console.error(`Review ${journalPath} and CapRover before retrying. No automatic restore or rollback was attempted.`);
  process.exitCode = 1;
} finally {
  if (lock) {
    await lock.close();
    const uncertainDeployment = journal?.status === "stopped" && Object.values(journal.targets).some((target) => target.phase === "deploy-requested");
    if (uncertainDeployment) console.error("Rollout lock retained: inspect the in-flight/failed CapRover deployment before manually clearing it.");
    else await unlink(lockPath);
  }
}

async function saveJournal() {
  await writeFile(`${journalPath}.partial`, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  await rename(`${journalPath}.partial`, journalPath);
}

async function gitRaw(object) {
  // run() normally trims command output, which would corrupt migration hashes.
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["show", object], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", () => reject(new Error("Git source could not be read.")));
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error("Selected commit does not contain the required release files.")));
  });
}
