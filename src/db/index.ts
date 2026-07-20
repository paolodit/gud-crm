import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDatabase = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDatabase.pool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
  });

if (env.NODE_ENV !== "production") globalForDatabase.pool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
