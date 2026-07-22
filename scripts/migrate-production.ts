import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

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
    console.log(`Applying committed PostgreSQL migrations from ${migrationsFolder}.`);
    await migrate(drizzle(pool), { migrationsFolder });
    console.log("PostgreSQL migrations are current.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
