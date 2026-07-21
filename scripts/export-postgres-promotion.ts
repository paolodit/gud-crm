import "./load-env";

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildPostgresPromotionSql } from "../src/lib/data/postgres-promotion";

async function main() {
  const source = requiredArgument("--source");
  const output = requiredArgument("--output");
  const administratorEmail = requiredArgument("--admin-email");
  const organisationName = requiredArgument("--organisation-name");
  if (!process.argv.includes("--confirm-private-export")) {
    throw new Error("Promotion SQL contains private CRM data. Re-run with --confirm-private-export after confirming the output remains under ignored data/.");
  }

  const root = process.cwd();
  const dataRoot = path.resolve(root, "data");
  const sourcePath = requireInsideData(root, dataRoot, source);
  const outputPath = requireInsideData(root, dataRoot, output);
  if (!outputPath.toLowerCase().endsWith(".sql")) throw new Error("Promotion output must use a .sql extension.");

  process.env.DATA_BACKEND = "sqlite";
  process.env.SQLITE_PATH = path.relative(root, sourcePath);
  const { createLocalDatabaseBackup, getLocalAiEnabled, getLocalBoardSnapshot } = await import("../src/lib/data/local-store");
  const snapshot = getLocalBoardSnapshot();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(path.dirname(outputPath), `${path.basename(sourcePath, path.extname(sourcePath))}.before-postgres-${stamp}.sqlite`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  await createLocalDatabaseBackup(backupPath);

  const promotion = buildPostgresPromotionSql(snapshot, {
    administratorEmail,
    organisationName,
    aiEnabled: getLocalAiEnabled(),
  });
  writeFileSync(outputPath, promotion.sql, { encoding: "utf8", flag: "wx" });
  const checksum = createHash("sha256").update(promotion.sql).digest("hex");
  writeFileSync(`${outputPath}.manifest.json`, `${JSON.stringify({ ...promotion.manifest, checksum, backupPath }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ outputPath, backupPath, checksum, ...promotion.manifest }, null, 2));
}

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

function requireInsideData(root: string, dataRoot: string, candidate: string) {
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(dataRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Private promotion sources and outputs must remain under the ignored data/ directory.");
  }
  return resolved;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
