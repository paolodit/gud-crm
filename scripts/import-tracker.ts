import path from "node:path";

import "./load-env";

import { commitTrackerImport, commitTrackerImportToLocal, previewTrackerImport } from "../src/lib/import/tracker";
import { env } from "../src/lib/env";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const filePath = path.resolve(
    positional[0] ?? "data/imports/outreach-tracker.xlsx",
  );

  const preview = await previewTrackerImport(filePath);
  console.log(
    JSON.stringify(
      {
        file: preview.fileName,
        checksum: preview.checksum,
        totalRows: preview.totalRows,
        uniqueCompanies: preview.companies,
        contacts: preview.contacts,
        duplicateSourceRows: preview.duplicateSourceRows,
        invalidRows: preview.invalidRows,
        stageCounts: preview.rows.reduce<Record<string, number>>((counts, row) => {
          counts[row.stage] = (counts[row.stage] ?? 0) + 1;
          return counts;
        }, {}),
        invalid: preview.rows.filter((row) => row.action === "invalid"),
      },
      null,
      2,
    ),
  );

  if (commit) {
    if (env.demoMode) throw new Error("Set DATA_BACKEND=sqlite or postgres before using --commit.");
    const organisationId = process.env.ORGANISATION_ID;
    if (env.postgresMode && !organisationId) throw new Error("Set ORGANISATION_ID before committing to PostgreSQL.");
    const result = env.sqliteMode
      ? commitTrackerImportToLocal(preview, process.env.IMPORT_USER_ID)
      : await commitTrackerImport(preview, organisationId!, process.env.IMPORT_USER_ID);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
