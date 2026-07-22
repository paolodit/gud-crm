import "./load-env";

import path from "node:path";

import {
  createLocalDatabaseBackup,
  exportLocalWorkspace,
  localWorkspaceStatus,
  resetLocalWorkspace,
} from "../src/lib/data/local-store";

const args = process.argv.slice(2);
const [command = "status", destination = "gud-crm-local-export.json"] = args;

async function main() {
  if (command === "reset") {
    if (!args.includes("--confirm-reset")) {
      throw new Error("Reset is destructive. Re-run with --confirm-reset; GUD will create a safety backup first.");
    }
    const before = localWorkspaceStatus();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(
      path.dirname(before.file),
      `${path.basename(before.file, path.extname(before.file))}.before-reset-${stamp}.sqlite`,
    );
    await createLocalDatabaseBackup(backup);
    const snapshot = resetLocalWorkspace();
    console.log(`Safety backup created at ${backup}.`);
    console.log(`SQLite workspace reset with ${snapshot.opportunities.length} opportunities.`);
  } else if (command === "backup") {
    const before = localWorkspaceStatus();
    const output = destination === "gud-crm-local-export.json"
      ? path.join(path.dirname(before.file), `${path.basename(before.file, path.extname(before.file))}.backup.sqlite`)
      : destination;
    await createLocalDatabaseBackup(output);
    console.log(`Consistent SQLite backup created at ${path.resolve(output)}.`);
  } else if (command === "export") {
    console.log(`SQLite workspace exported to ${exportLocalWorkspace(destination)}.`);
  } else if (command === "status") {
    console.log(JSON.stringify(localWorkspaceStatus(), null, 2));
  } else {
    throw new Error(`Unknown local database command: ${command}. Use status, backup, export or reset.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
