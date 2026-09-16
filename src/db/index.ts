import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

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

const database = drizzle(pool, { schema });
export type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const transactions = new AsyncLocalStorage<Transaction>();
// Existing services can participate in a single action bundle without opening
// independent transactions. AsyncLocalStorage isolates concurrent requests.
export const db: Database = new Proxy(database, {
  get(target, property) {
    const current = transactions.getStore() ?? target;
    const value = Reflect.get(current, property, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
export async function withDatabaseTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (transactions.getStore()) return work();
  return database.transaction((tx) => transactions.run(tx, work));
}
