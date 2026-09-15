import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { assertAdditiveMigrations, MigrationSafetyError, pendingMigrations } from "../src/lib/deployment/migrations";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required before PostgreSQL migrations can run.");

  const migrationsFolder = path.resolve(process.env.GUD_MIGRATIONS_DIR ?? "drizzle");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("SET lock_timeout = '60s'");
      await client.query("SELECT pg_advisory_lock(718204, 1)");
      const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger");
      const applied = exists.rows[0].ledger
        ? (await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows
        : [];
      // Older application images may boot against a newer additive schema during a manual rollback.
      // The rollout preflight remains strict and will not deploy an older migration history forward.
      const pending = pendingMigrations(readMigrationFiles({ migrationsFolder }), applied, true);
      if (process.env.GUD_RELEASE_GUARDED === "true") {
        if (!applied.length) throw new MigrationSafetyError("Guarded releases cannot initialise an empty database.");
        assertAdditiveMigrations(pending);
      }
      console.log(`Applying ${pending.length} pending PostgreSQL migrations.`);
      await migrate(drizzle(client), { migrationsFolder });
      console.log("PostgreSQL migrations are current.");
    } finally {
      await client.query("SELECT pg_advisory_unlock(718204, 1)").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof MigrationSafetyError ? error.message : "PostgreSQL migration failed. Review database access and migration compatibility privately.");
  process.exitCode = 1;
});
