import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { assertAdditiveMigrations } from "../deployment/migrations";

it("accepts the pending Thoughts schema without modifying existing records", () => {
  const sql = readFileSync("drizzle/0011_famous_winter_soldier.sql", "utf8");
  expect(() => assertAdditiveMigrations([{ hash: "thoughts-fixture", folderMillis: 1, sql: [sql] }])).not.toThrow();
});
