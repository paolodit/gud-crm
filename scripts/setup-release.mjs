import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { inspectTarget, assertSeparateInstances, registryRepository, validateConfig } from "./release/core.mjs";
import { settingsPath, validateSettings } from "./release/settings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function command(program, args, input, terminal = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, shell: false, stdio: [terminal ? "inherit" : "pipe", "pipe", terminal ? "inherit" : "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stdin?.on("error", () => undefined);
    child.once("error", () => reject(new Error(`${program} could not start.`)));
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8").trim()) : reject(new Error(`${program} failed; no credentials have been displayed.`)));
    child.stdin?.end(input ?? "");
  });
}
async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.uid !== 0 || (metadata.mode & 0o077) || await realpath(directory) !== directory) {
    throw new Error(`${directory} must be a real root-owned directory with mode 0700.`);
  }
}
async function prompt(label, fallback) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback; }
  finally { rl.close(); }
}
const secret = (label) => command("systemd-ask-password", ["--timeout=0", "--echo=masked", `${label}:`], undefined, true);

try {
  if (process.platform !== "linux" || process.getuid() !== 0 || !process.stdin.isTTY || Number(process.versions.node.split(".")[0]) !== 24) {
    throw new Error("Run this interactive setup as root on the Linux CapRover manager using Node 24.");
  }
  process.umask(0o077);
  try { await lstat(settingsPath); throw new Error("Saved rollout settings already exist. Setup will not overwrite them."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const config = validateConfig(JSON.parse(await readFile(path.join(root, "config/rollout.json"), "utf8")));
  const nodes = (await command("docker", ["node", "ls", "--format", "{{.ID}}"])).split("\n").filter(Boolean);
  if (nodes.length !== 1) throw new Error("This setup requires the existing single-node CapRover manager.");
  const instances = [];
  for (const target of config.targets) {
    const services = JSON.parse(await command("docker", ["service", "inspect", `srv-captain--${target.app}`]));
    instances.push(inspectTarget(target, services[0]));
  }
  assertSeparateInstances(instances);
  console.log("Existing Demo, Refresh and HSM settings checked. No apps or databases changed.");
  const mount = await prompt("Mounted off-host backup directory", "/mnt/gud-backups");
  if (!path.isAbsolute(mount) || path.normalize(mount) !== mount || mount === "/") throw new Error("Enter the absolute mounted backup directory.");
  await command("mountpoint", ["-q", mount]);
  console.log(`Backup filesystem: ${await command("findmnt", ["-rn", "-T", mount, "-o", "FSTYPE"])}`);
  if (await prompt("Confirm this is your private off-host backup storage (type yes)") !== "yes") throw new Error("Setup cancelled.");
  const repository = registryRepository(await prompt("Private image repository", "ghcr.io/paolodit/gud-crm-releases"));
  if (await prompt("Confirm this repository is private, or a new GHCR package (type yes)") !== "yes") throw new Error("Setup cancelled.");
  const settings = {
    GUD_RELEASE_IMAGE_REPOSITORY: repository,
    GUD_RELEASE_STATE_DIR: "/var/lib/gud-releases",
    GUD_RELEASE_BACKUP_DIR: "/var/backups/gud-releases",
    GUD_RELEASE_BACKUP_COPY_DIR: path.join(mount, "releases"),
    DOCKER_CONFIG: "/etc/gud-release/docker",
  };
  for (const directory of [path.dirname(settingsPath), ...Object.entries(settings).filter(([key]) => key.endsWith("_DIR") || key === "DOCKER_CONFIG").map(([, value]) => value)]) {
    await privateDirectory(directory);
  }
  console.log("Paste each app deployment token at its masked prompt. Do not enter the CapRover administrator password.");
  for (const target of config.targets) {
    const token = await secret(`${target.app} deployment token`);
    if (!token || /[\r\n\0]/.test(token)) throw new Error(`${target.app}: empty or invalid token.`);
    const response = await fetch(`${config.captainUrl}/api/v2/user/apps/appData/${target.app}`, {
      redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "x-namespace": "captain", "x-captain-app-token": token },
    }).catch(() => { throw new Error(`${target.app}: cannot reach CapRover.`); });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 100 || typeof result.data?.isAppBuilding !== "boolean") {
      throw new Error(`${target.app}: deployment token not accepted. Nothing deployed.`);
    }
    settings[target.tokenEnv] = token;
    console.log(`${target.app}: deployment token verified.`);
  }
  const username = await prompt("Registry username", repository.startsWith("ghcr.io/") ? repository.split("/")[1] : undefined);
  if (!username || /[\r\n\0]/.test(username)) throw new Error("Registry username is required.");
  const password = await secret("Registry push token (GHCR: classic token with write:packages)");
  if (!password) throw new Error("Registry token is required.");
  await command("docker", ["--config", settings.DOCKER_CONFIG, "login", repository.split("/")[0], "--username", username, "--password-stdin"], password + "\n");
  validateSettings(settings);
  const file = await open(settingsPath, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(settings, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  console.log(`\nServer setup saved privately to ${settingsPath}. No application was deployed.`);
  console.log("Also add the registry in CapRover > Cluster > Docker Registry, with a read-only registry token.");
  console.log("After that, from a clean checkout of the reviewed commit: npm run release:all -- --ref <full-commit-sha>");
  console.log("Saved settings load automatically. No shell exports or repeated token entry are needed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup stopped. No application was deployed.");
  process.exitCode = 1;
}
