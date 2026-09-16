import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectTarget, registryRepository, releaseHealth, releaseOptions, rollout, validateConfig, verifySnapshot } from "./core.mjs";

test("targeted releases retain canary order and never silently include HSM", () => {
  assert.deepEqual(releaseOptions("apply", ["--ref", "abc123", "--targets", "demo,refresh"]), { ref: "abc123", targets: "demo,refresh" });
  assert.equal(releaseOptions("plan", []).targets, "demo,refresh,hsm");
  for (const targets of ["refresh", "hsm", "refresh,demo", "demo,hsm", "demo,refresh,other", "demo,demo"]) assert.throws(() => releaseOptions("apply", ["--targets", targets]));
  assert.throws(() => releaseOptions("apply", ["--targets"]));
  assert.throws(() => releaseOptions("apply", ["--ref", "main", "--ref", "other"]));
});

const config = JSON.parse(readFileSync(new URL("../../config/rollout.json", import.meta.url)));
const target = config.targets[1];
const migration = { hash: "first", folderMillis: 1, sql: ["CREATE TABLE notes (id int)"] };
const snapshot = () => ({ migrations: [{ hash: "first", created_at: "1" }], keys: { organisations: ["org"], users: ["user"], companies: ["company"], direct_projects: ["project"], delivery_checklist: ["task"] } });
test("registry references cannot contain credentials, schemes or mutable tags", () => {
  assert.equal(registryRepository("ghcr.io/example/gud-crm"), "ghcr.io/example/gud-crm");
  assert.equal(registryRepository("registry.example.com:996/gud-crm"), "registry.example.com:996/gud-crm");
  for (const value of [undefined, "https://registry.example.com/gud", "user:secret@registry.example/gud", "registry.example.com/gud:latest", "local-image"]) {
    assert.throws(() => registryRepository(value));
  }
});
function service(changes = {}) {
  const env = { DATA_BACKEND: "postgres", DATABASE_URL: "postgresql://user:password@srv-captain--db-refresh/gud",
    BETTER_AUTH_URL: "https://refresh.example", NEXT_PUBLIC_APP_URL: "https://refresh.example", BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters", ...changes };
  return { Spec: { Name: "srv-captain--gud-refresh", Mode: { Replicated: { Replicas: 1 } }, TaskTemplate: {
    ContainerSpec: { Image: "img:v1", Env: Object.entries(env).map(([key, value]) => `${key}=${value}`) },
  } } };
}

test("config fixes all three existing instances in canary order", () => {
  assert.deepEqual(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, targets: [...config.targets].reverse() }), /order/);
  assert.throws(() => validateConfig({ ...config, captainUrl: "http://captain.example" }), /HTTPS/);
});
test("preflight preserves settings and rejects bootstrap, wrong databases and release overrides", () => {
  assert.equal(inspectTarget(target, service()).origin, "https://refresh.example");
  for (const changes of [{ DATA_BACKEND: "sqlite" }, { GUD_BOOTSTRAP: "if-empty" }, { SEED_ALLOW_EXISTING: "true" }, { SEED_IF_EMPTY: "true" },
    { DATABASE_URL: "postgresql://user:password@unapproved.example/gud" }, { NEXT_PUBLIC_APP_URL: "http://refresh.example" },
    { BETTER_AUTH_URL: "https://other.example" }, { GUD_BUILD_REVISION: "old" }, { GUD_RELEASE_GUARDED: "false" }]) {
    assert.throws(() => inspectTarget(target, service(changes)));
  }
});
test("configuration fingerprints detect credential or mount changes without exposing values", () => {
  const original = inspectTarget(target, service());
  const changed = inspectTarget(target, service({ DATABASE_URL: "postgresql://user:different@srv-captain--db-refresh/gud" }));
  assert.notEqual(original.configurationIdentity, changed.configurationIdentity);
  assert.equal(original.databaseIdentity, changed.databaseIdentity);
  assert.equal(original.databaseIdentity, inspectTarget(target, service({ DATABASE_URL: "postgresql://user:password@srv-captain--db-refresh/%67ud" })).databaseIdentity);
  assert.match(original.databaseIdentity, /^[a-f0-9]{64}$/);
  assert.equal(original.configurationIdentity, inspectTarget(target, service({ CAPROVER_GIT_COMMIT_SHA: "new-release" })).configurationIdentity);
});
test("health must identify the actual new PostgreSQL release", () => {
  const good = { status: "ok", mode: "postgres", database: "connected", revision: "new" };
  assert.equal(releaseHealth(good, "new"), true);
  for (const change of [{ revision: "old" }, { revision: undefined }, { mode: "demo" }, { database: "unavailable" }]) {
    assert.equal(releaseHealth({ ...good, ...change }, "new"), false);
  }
});
test("existing records, nested projects/checklists and exact migration history must remain", () => {
  assert.equal(verifySnapshot(snapshot(), [migration], snapshot()), 0);
  for (const table of Object.keys(snapshot().keys)) {
    const after = snapshot(); after.keys[table] = [];
    assert.throws(() => verifySnapshot(after, [migration], snapshot()));
  }
  const more = snapshot(); more.keys.companies.push("new-company");
  assert.equal(verifySnapshot(more, [migration], snapshot()), 0);
  assert.throws(() => verifySnapshot({ keys: {}, migrations: [] }, [migration]), /empty databases/);
  assert.throws(() => verifySnapshot(snapshot(), [migration, { ...migration, hash: "next", folderMillis: 2 }], snapshot()), /pending/);
});

function mockAdapter(failAt, duplicate = false) {
  const events = [];
  const event = async (name, result) => { events.push(name); if (name === failAt) throw new Error("simulated failure"); return result; };
  return { events, adapter: {
    preflight: (t) => event(`preflight:${t.id}`, { target: t, databaseIdentity: duplicate ? "same" : t.id, authIdentity: t.id, origin: t.id }),
    build: () => event("build", { tag: "one-image", id: "one-id" }),
    backup: (i) => event(`backup:${i.target.id}`),
    assertUnchanged: (i) => event(`unchanged:${i.target.id}`),
    deploy: (i, image) => { assert.equal(image.id, "one-id"); return event(`deploy:${i.target.id}`); },
    verify: (i) => event(`verify:${i.target.id}`),
  } };
}
test("all preflights and backups precede deployment, and one image rolls out serially", async () => {
  const { adapter, events } = mockAdapter();
  await rollout(config.targets, adapter);
  assert.deepEqual(events, ["preflight:demo", "preflight:refresh", "preflight:hsm", "build", "backup:demo", "backup:refresh", "backup:hsm",
    "unchanged:demo", "deploy:demo", "verify:demo", "unchanged:refresh", "deploy:refresh", "verify:refresh", "unchanged:hsm", "deploy:hsm", "verify:hsm"]);
});
for (const failure of ["preflight:refresh", "build", "backup:demo", "backup:refresh", "backup:hsm"]) {
  test(`${failure} failure cannot change any app`, async () => {
    const { adapter, events } = mockAdapter(failure);
    await assert.rejects(rollout(config.targets, adapter));
    assert.equal(events.some((event) => event.startsWith("deploy:")), false);
  });
}
for (const failure of ["unchanged:demo", "deploy:demo", "verify:demo", "verify:refresh"]) {
  test(`${failure} failure stops the remaining rollout`, async () => {
    const { adapter, events } = mockAdapter(failure);
    await assert.rejects(rollout(config.targets, adapter));
    assert.equal(events.includes("deploy:hsm"), false);
    if (failure.endsWith("demo")) assert.equal(events.includes("deploy:refresh"), false);
  });
}
test("a shared database blocks all deployment", async () => {
  const { adapter, events } = mockAdapter(undefined, true);
  await assert.rejects(rollout(config.targets, adapter), /separate/);
  assert.equal(events.includes("build"), false);
});
test("runner uses image-only CapRover deployment and contains no destructive database/volume commands", () => {
  const runner = readFileSync(new URL("../release-all.mjs", import.meta.url), "utf8");
  assert.match(runner, /captainDefinitionContent/);
  assert.doesNotMatch(runner, /apps\/appDefinitions|docker.*prune|db:push|db:seed|DROP DATABASE|TRUNCATE TABLE/);
  assert.match(runner, /pg_dump/);
  assert.match(runner, /pg_restore.*--list/);
  assert.match(runner, /COPYFILE_EXCL/);
  assert.match(runner, /imageName: image.reference/);
});
