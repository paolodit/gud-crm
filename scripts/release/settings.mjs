import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { registryRepository } from "./core.mjs";

export const settingsPath = "/etc/gud-release/rollout.json";
export const settingsKeys = [
  "GUD_DEPLOY_TOKEN_DEMO", "GUD_DEPLOY_TOKEN_REFRESH", "GUD_DEPLOY_TOKEN_HSM",
  "GUD_RELEASE_IMAGE_REPOSITORY", "GUD_RELEASE_STATE_DIR",
  "GUD_RELEASE_BACKUP_DIR", "GUD_RELEASE_BACKUP_COPY_DIR", "DOCKER_CONFIG",
];

export function validateSettings(settings) {
  if (!settings || Array.isArray(settings) || typeof settings !== "object"
    || Object.keys(settings).some((key) => !settingsKeys.includes(key))) {
    throw new Error("Release settings contain unexpected fields.");
  }
  for (const key of settingsKeys) {
    if (typeof settings[key] !== "string" || !settings[key].trim() || /[\r\n\0]/.test(settings[key])) {
      throw new Error(`${key} must have a non-empty, single-line value.`);
    }
    if ((key.endsWith("_DIR") || key === "DOCKER_CONFIG") && !path.posix.isAbsolute(settings[key])) {
      throw new Error(`${key} must be an absolute server path.`);
    }
  }
  registryRepository(settings.GUD_RELEASE_IMAGE_REPOSITORY);
  return settings;
}

export async function loadSettings(file, { uid = process.getuid?.() } = {}) {
  // Reject symlinks and permissive ownership before reading any secret bytes.
  const parent = await lstat(path.dirname(file));
  if (!parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o077)) {
    throw new Error("Release settings directory must be operator-owned and mode 0700.");
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== uid || (metadata.mode & 0o077) || metadata.size > 16384) {
      throw new Error("Release settings must be an operator-owned private file (0600).");
    }
    let settings;
    try { settings = JSON.parse(await handle.readFile("utf8")); }
    catch { throw new Error("Release settings are not valid JSON; values have not been displayed."); }
    return validateSettings(settings);
  } finally { await handle.close(); }
}

export function mergeSettings(environment, saved) {
  for (const key of settingsKeys) {
    if (environment[key] !== undefined && environment[key] !== saved[key]) {
      throw new Error(`${key} conflicts with the saved release settings. Clear the override or review the private configuration.`);
    }
  }
  Object.assign(environment, saved);
}
