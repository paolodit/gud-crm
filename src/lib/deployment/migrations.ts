export type ReleaseMigration = { hash: string; folderMillis: number; sql: string[] };
export type AppliedMigration = { hash: string; created_at: string | number };

export class MigrationSafetyError extends Error {}

/** Applied history must be an exact prefix: never silently edit or skip a migration. */
export function pendingMigrations(files: ReleaseMigration[], applied: AppliedMigration[], allowNewerSchema = false) {
  if (files.some((file, index) => index > 0 && file.folderMillis <= files[index - 1].folderMillis)) {
    throw new MigrationSafetyError("Migration timestamps must increase strictly.");
  }
  if ((!allowNewerSchema && applied.length > files.length) || applied.slice(0, files.length).some((row, index) =>
    row.hash !== files[index].hash || Number(row.created_at) !== files[index].folderMillis)) {
    throw new MigrationSafetyError("Database migration history differs from this release. Stop for review.");
  }
  return files.slice(applied.length);
}

/** Conservative gate, not a SQL security sandbox. Other changes need a reviewed maintenance release. */
export function assertAdditiveMigrations(files: ReleaseMigration[]) {
  for (const file of files) {
    for (const block of file.sql) {
      const tokens = block.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (token) =>
        token.startsWith("--") || token.startsWith("/*") ? " " : token.startsWith('"') ? "identifier" : "'value'");
      for (const statement of tokens.split(";").map((part) => part.trim()).filter(Boolean)) {
        const permitted = /^(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TYPE)\b|ALTER\s+TABLE\s+\S+\s+ADD\b|ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b)/i.test(statement);
        const withoutReferences = statement.replace(/\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+(?:NULL|DEFAULT))\b/gi, "");
        if (!permitted || /\$|\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|COPY|EXECUTE|RENAME)\b/i.test(withoutReferences)) {
          throw new MigrationSafetyError("A pending migration is not additive. A reviewed maintenance release is required.");
        }
      }
    }
  }
}
