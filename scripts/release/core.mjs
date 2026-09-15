import { createHash } from "node:crypto";
import { assertAdditiveMigrations, pendingMigrations } from "../../src/lib/deployment/migrations.ts";

export const digest = (value) => createHash("sha256").update(value).digest("hex");

export function registryRepository(value) {
  if (!value || !/^[a-z0-9]+(?:[-.][a-z0-9]+)+(?::\d+)?\/[a-z0-9][a-z0-9/_-]*$/.test(value)) {
    throw new Error("GUD_RELEASE_IMAGE_REPOSITORY must be a private registry repository, such as registry.example.com/gud-crm (without scheme, tag or credentials).");
  }
  return value;
}

export function validateConfig(config) {
  if (config.schemaVersion !== 1 || config.targets?.map((target) => target.id).join(",") !== "demo,refresh,hsm") {
    throw new Error("The release must contain Demo, Refresh and HSM, in that order.");
  }
  const captain = new URL(config.captainUrl);
  if (captain.protocol !== "https:" || captain.username || captain.password || captain.origin !== config.captainUrl) {
    throw new Error("CapRover must be an HTTPS origin without credentials.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.imageRepository)) throw new Error("Invalid local image repository.");
  for (const target of config.targets) {
    if (target.app !== `gud-${target.id}` || target.tokenEnv !== `GUD_DEPLOY_TOKEN_${target.id.toUpperCase()}`) {
      throw new Error("Unexpected deployment target or token name.");
    }
  }
  return config;
}

export function inspectTarget(target, service) {
  if (service.Spec?.Name !== `srv-captain--${target.app}` || service.Spec?.Mode?.Replicated?.Replicas !== 1) {
    throw new Error(`${target.id}: expected the existing single-replica app service.`);
  }
  const container = service.Spec.TaskTemplate.ContainerSpec;
  const environment = Object.fromEntries((container.Env ?? []).map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const fail = (message) => { throw new Error(`${target.id}: ${message}`); };
  if (environment.DATA_BACKEND !== "postgres") fail("DATA_BACKEND must be postgres.");
  if ((environment.GUD_BOOTSTRAP ?? "off") !== "off" || ["SEED_ALLOW_EXISTING", "SEED_IF_EMPTY"].some((key) => environment[key] === "true")) {
    fail("turn off bootstrap/seeding before using the existing-data release process.");
  }
  if (environment.GUD_BUILD_REVISION !== undefined || environment.GUD_RELEASE_GUARDED !== undefined) {
    fail("remove runtime release metadata overrides; these belong to the image.");
  }
  let database, publicUrl, authUrl;
  try {
    database = new URL(environment.DATABASE_URL);
    publicUrl = new URL(environment.NEXT_PUBLIC_APP_URL);
    authUrl = new URL(environment.BETTER_AUTH_URL);
  } catch { fail("database and public/authentication URLs must be configured."); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.username || !database.password || database.pathname.length < 2) {
    fail("a complete PostgreSQL connection is required.");
  }
  if (!/^srv-captain--[a-z0-9-]+$/.test(database.hostname) || (database.port && database.port !== "5432")) {
    fail("this runner supports the existing CapRover-hosted PostgreSQL services on port 5432 only.");
  }
  if (publicUrl.protocol !== "https:" || publicUrl.origin !== authUrl.origin || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/") {
    fail("matching HTTPS application/authentication origins are required.");
  }
  if ((environment.BETTER_AUTH_SECRET ?? "").length < 32) fail("the existing authentication secret is missing or too short.");
  return {
    target, environment, database, origin: publicUrl.origin,
    databaseIdentity: digest(`${database.hostname}:5432/${decodeURIComponent(database.pathname.slice(1))}`),
    authIdentity: digest(environment.BETTER_AUTH_SECRET),
    // CapRover manages this release-specific variable itself; all application configuration remains fixed.
    configurationIdentity: digest(JSON.stringify({ env: (container.Env ?? []).filter((entry) => !entry.startsWith("CAPROVER_GIT_COMMIT_SHA=")).sort(), mounts: container.Mounts ?? [], secrets: container.Secrets ?? [], configs: container.Configs ?? [] })),
    previousImage: container.Image,
  };
}

export function assertSeparateInstances(instances) {
  for (const key of ["databaseIdentity", "authIdentity", "origin"]) {
    if (new Set(instances.map((instance) => instance[key])).size !== instances.length) {
      throw new Error(`Instances must have separate databases, authentication secrets and origins (${key}).`);
    }
  }
}

export function verifySnapshot(snapshot, migrations, before) {
  if (!snapshot.keys?.organisations?.length || !snapshot.keys?.users?.length || !snapshot.migrations?.length) {
    throw new Error("Existing workspace records and migration history are required; empty databases are never initialised by rollout.");
  }
  const pending = pendingMigrations(migrations, snapshot.migrations);
  assertAdditiveMigrations(pending);
  if (before) {
    if (pending.length) throw new Error("The deployed database still has pending migrations.");
    for (const [table, keys] of Object.entries(before.keys)) {
      const retained = new Set(snapshot.keys[table] ?? []);
      if (keys.some((key) => !retained.has(key))) {
        throw new Error("Existing records are missing after rollout. Stop and investigate; do not restore automatically.");
      }
    }
  }
  return pending.length;
}

export function snapshotCounts(snapshot) {
  return Object.fromEntries(Object.entries(snapshot.keys).map(([table, keys]) => [table, keys.length]));
}

export function releaseHealth(health, revision) {
  return health?.status === "ok" && health.mode === "postgres" && health.database === "connected" && health.revision === revision;
}

/** All preflights and all backups finish before the first application is changed. */
export async function rollout(targets, adapter) {
  const instances = [];
  for (const target of targets) instances.push(await adapter.preflight(target));
  assertSeparateInstances(instances);
  const image = await adapter.build();
  for (const instance of instances) await adapter.backup(instance);
  for (const instance of instances) {
    await adapter.assertUnchanged(instance);
    await adapter.deploy(instance, image);
    await adapter.verify(instance, image);
  }
  return image;
}
