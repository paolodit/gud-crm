import fs from "node:fs";
import path from "node:path";

function help() {
  console.log(`GUD CRM deployment preflight

Usage:
  node scripts/deployment-preflight.mjs [--env <path>]

With --env, values are read from a private dotenv file and merged over the
current process environment. Secret values are never printed.`);
}

function parseArgs(argv) {
  const result = { envFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help();
      process.exit(0);
    }
    if (argument === "--env") {
      const value = argv[index + 1];
      if (!value) throw new Error("--env requires a file path");
      result.envFile = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function parseDotenv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const errors = [];
const warnings = [];

function requireValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) errors.push(`${name}: required`);
  return value ?? "";
}

function looksLikePlaceholder(value) {
  return /(^|[-_])(replace|change|example|placeholder|your)([-_]|$)|example\.com|\.example$/iu.test(
    value,
  );
}

function parseUrl(name, value, protocols) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) {
      errors.push(`${name}: expected ${protocols.join(" or ")}`);
      return null;
    }
    return parsed;
  } catch {
    errors.push(`${name}: not a valid URL`);
    return null;
  }
}

try {
  const { envFile } = parseArgs(process.argv.slice(2));
  let fileValues = {};
  if (envFile) {
    const resolved = path.resolve(envFile);
    if (!fs.existsSync(resolved)) throw new Error(`Environment file not found: ${envFile}`);
    fileValues = parseDotenv(fs.readFileSync(resolved, "utf8"));
  }

  const environment = { ...process.env, ...fileValues };
  const backend = requireValue(environment, "DATA_BACKEND");
  if (backend && backend !== "postgres") {
    errors.push("DATA_BACKEND: live team deployments must use postgres");
  }

  const databaseUrl = requireValue(environment, "DATABASE_URL");
  const parsedDatabase = parseUrl("DATABASE_URL", databaseUrl, ["postgres:", "postgresql:"]);
  if (parsedDatabase && (!parsedDatabase.username || !parsedDatabase.pathname.slice(1))) {
    errors.push("DATABASE_URL: include an instance-specific database user and database name");
  }
  if (databaseUrl && looksLikePlaceholder(databaseUrl)) {
    errors.push("DATABASE_URL: replace the documented placeholder value");
  }

  const authSecret = requireValue(environment, "BETTER_AUTH_SECRET");
  if (authSecret && authSecret.length < 32) {
    errors.push("BETTER_AUTH_SECRET: use at least 32 characters");
  }
  if (authSecret && looksLikePlaceholder(authSecret)) {
    errors.push("BETTER_AUTH_SECRET: replace the documented placeholder value");
  }

  const appUrl = environment.NEXT_PUBLIC_APP_URL?.trim() || environment.APP_URL?.trim();
  const authUrl = requireValue(environment, "BETTER_AUTH_URL");
  if (!appUrl) errors.push("NEXT_PUBLIC_APP_URL or APP_URL: required");
  const parsedApp = parseUrl("application URL", appUrl, ["https:"]);
  const parsedAuth = parseUrl("BETTER_AUTH_URL", authUrl, ["https:"]);
  if (parsedApp && parsedAuth && parsedApp.origin !== parsedAuth.origin) {
    errors.push("BETTER_AUTH_URL: must match the public application origin exactly");
  }
  if ((appUrl && looksLikePlaceholder(appUrl)) || (authUrl && looksLikePlaceholder(authUrl))) {
    errors.push("application URL: replace the documented example hostname");
  }

  const model = requireValue(environment, "GUD_DEFAULT_MODEL");
  if (model && !["focused", "service"].includes(model)) {
    errors.push("GUD_DEFAULT_MODEL: use focused or service");
  }
  requireValue(environment, "GUD_INSTANCE_NAME");

  const bootstrap = environment.GUD_BOOTSTRAP?.trim() || "off";
  if (!["off", "if-empty"].includes(bootstrap)) {
    errors.push("GUD_BOOTSTRAP: use off or if-empty");
  }
  if (bootstrap === "if-empty") {
    requireValue(environment, "SEED_ORGANISATION_NAME");
    requireValue(environment, "SEED_ADMIN_NAME");
    const email = requireValue(environment, "SEED_ADMIN_EMAIL");
    const password = requireValue(environment, "SEED_ADMIN_PASSWORD");
    if (email && (!email.includes("@") || looksLikePlaceholder(email))) {
      errors.push("SEED_ADMIN_EMAIL: use the real initial administrator address");
    }
    if (password && password.length < 12) {
      errors.push("SEED_ADMIN_PASSWORD: use at least 12 characters");
    }
    if (password && looksLikePlaceholder(password)) {
      errors.push("SEED_ADMIN_PASSWORD: replace the documented placeholder value");
    }
  } else if (environment.SEED_ADMIN_PASSWORD?.trim()) {
    warnings.push("SEED_ADMIN_PASSWORD: remove it after first boot when GUD_BOOTSTRAP is off");
  }

  if (environment.MCP_ENABLED === "true" && !parsedApp) {
    errors.push("MCP_ENABLED: requires a valid public HTTPS application URL");
  }

  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (errors.length) {
    console.error("Deployment preflight failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log("Deployment preflight passed.");
  console.log("No secret values were printed. Verify a current backup before deployment.");
} catch (error) {
  console.error(`Deployment preflight failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
