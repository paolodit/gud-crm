import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSettings, validateSettings, mergeSettings } from "./settings.mjs";

const valid = () => ({
  GUD_DEPLOY_TOKEN_DEMO: "demo-test-token", GUD_DEPLOY_TOKEN_REFRESH: "refresh-test-token", GUD_DEPLOY_TOKEN_HSM: "hsm-test-token",
  GUD_RELEASE_IMAGE_REPOSITORY: "ghcr.io/example/private-releases", GUD_RELEASE_STATE_DIR: "/var/lib/gud-releases",
  GUD_RELEASE_BACKUP_DIR: "/var/backups/gud-releases", GUD_RELEASE_BACKUP_COPY_DIR: "/mnt/backups/releases", DOCKER_CONFIG: "/etc/gud-release/docker",
});
test("saved settings accept only the narrow runner configuration", () => {
  assert.deepEqual(validateSettings(valid()), valid());
  for (const value of [null, [], {}, { ...valid(), DATABASE_URL: "not-allowed" }, { ...valid(), NODE_OPTIONS: "not-allowed" }]) {
    assert.throws(() => validateSettings(value));
  }
});
test("empty tokens, injected lines, relative paths and invalid registries fail closed", () => {
  for (const change of [{ GUD_DEPLOY_TOKEN_DEMO: "" }, { GUD_DEPLOY_TOKEN_HSM: "one\ntwo" },
    { GUD_RELEASE_BACKUP_DIR: "relative" }, { DOCKER_CONFIG: "relative" }, { GUD_RELEASE_IMAGE_REPOSITORY: "local:latest" }]) {
    assert.throws(() => validateSettings({ ...valid(), ...change }));
  }
});
test("saved settings never silently override conflicting shell configuration", () => {
  const env = { PATH: "/usr/bin" };
  mergeSettings(env, valid());
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.GUD_DEPLOY_TOKEN_DEMO, "demo-test-token");
  mergeSettings(env, valid());
  assert.throws(() => mergeSettings({ GUD_RELEASE_BACKUP_DIR: "/elsewhere" }, valid()), /conflicts/);
});
test("private settings reject permissive files, parents, symlinks and malformed JSON", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gud-settings-test-"));
  const file = path.join(directory, "rollout.json");
  try {
    await chmod(directory, 0o700);
    await writeFile(file, JSON.stringify(valid()), { mode: 0o600 });
    assert.deepEqual(await loadSettings(file), valid());
    await chmod(file, 0o644);
    await assert.rejects(loadSettings(file), /private file/);
    await chmod(file, 0o600);
    await chmod(directory, 0o755);
    await assert.rejects(loadSettings(file), /directory/);
    await chmod(directory, 0o700);
    const link = path.join(directory, "linked.json");
    await symlink(file, link);
    await assert.rejects(loadSettings(link));
    await writeFile(file, '{"private-value-that-must-not-leak":');
    await assert.rejects(loadSettings(file), (error) => !error.message.includes("private-value-that-must-not-leak") && error.message.includes("not valid JSON"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
