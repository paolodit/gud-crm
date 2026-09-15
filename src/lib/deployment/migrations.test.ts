import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrations, pendingMigrations, type ReleaseMigration } from "./migrations";

const migration = (sql: string, folderMillis = 1): ReleaseMigration => ({ hash: `hash-${folderMillis}`, folderMillis, sql: [sql] });

describe("guarded migrations", () => {
  it("only returns the pending suffix, including repeat runs", () => {
    const files = [migration("CREATE TABLE a (id int)", 1), migration("ALTER TABLE a ADD name text", 2)];
    expect(pendingMigrations(files, [{ hash: "hash-1", created_at: "1" }])).toEqual([files[1]]);
    expect(pendingMigrations(files, files.map((file) => ({ hash: file.hash, created_at: file.folderMillis })))).toEqual([]);
  });
  it("rejects changed, skipped, newer or reordered history", () => {
    const files = [migration("", 1), migration("", 2)];
    expect(() => pendingMigrations(files, [{ hash: "modified", created_at: 1 }])).toThrow(/history/);
    expect(() => pendingMigrations(files, [{ hash: "hash-2", created_at: 2 }])).toThrow(/history/);
    expect(() => pendingMigrations([], [{ hash: "hash-1", created_at: 1 }])).toThrow(/history/);
    expect(() => pendingMigrations([files[1], files[0]], [])).toThrow(/timestamps/);
  });
  it("lets a rollback image boot against a newer additive schema without running down migrations", () => {
    const files = [migration("", 1)];
    expect(pendingMigrations(files, [{ hash: "hash-1", created_at: 1 }, { hash: "hash-2", created_at: 2 }], true)).toEqual([]);
    expect(() => pendingMigrations(files, [{ hash: "changed", created_at: 1 }, { hash: "hash-2", created_at: 2 }], true)).toThrow(/history/);
  });
  it.each([
    "DROP TABLE customers", "TRUNCATE customers", "DELETE FROM customers", "UPDATE customers SET name = 'x'",
    "INSERT INTO customers VALUES (1)", "ALTER TABLE customers DROP COLUMN name", "ALTER TABLE customers RENAME TO people",
    "ALTER TABLE customers ALTER COLUMN name TYPE int", "DO $$ BEGIN DELETE FROM customers; END $$",
    "CREATE TABLE harmless (id int); DELETE FROM customers", "CREATE OR REPLACE FUNCTION f() RETURNS int AS 'x' LANGUAGE sql",
    "ALTER TABLE customers ADD name text, DROP COLUMN email",
  ])("requires manual review for %s", (sql) => {
    expect(() => assertAdditiveMigrations([migration(sql)])).toThrow(/maintenance/);
  });
  it("allows ordinary additive DDL and foreign-key referential actions", () => {
    expect(() => assertAdditiveMigrations([migration(`
      CREATE TABLE "notes" ("id" uuid, "text" text DEFAULT 'Don''t DROP; anything');
      -- DROP in this comment isn't SQL
      ALTER TABLE "notes" ADD CONSTRAINT "notes_user" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
      CREATE INDEX "notes_idx" ON "notes" ("id");
      ALTER TYPE "status" ADD VALUE 'waiting';
    `)])).not.toThrow();
  });
  it("accepts the pending Thoughts schema without modifying existing records", () => {
    const sql = readFileSync("drizzle/0011_famous_winter_soldier.sql", "utf8");
    expect(() => assertAdditiveMigrations([migration(sql)])).not.toThrow();
  });
});
