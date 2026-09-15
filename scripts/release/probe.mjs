// Runs through stdin INSIDE an existing app container. No credentials in argv or output.
import { Pool } from "pg";
import { createHash } from "node:crypto";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '45s'");
      const migrations = (await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows;
      const tables = (await client.query(`
        SELECT c.relname AS name, array_agg(a.attname ORDER BY k.ordinality) AS columns
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public' AND i.indisprimary
        GROUP BY c.relname ORDER BY c.relname
      `)).rows;
      const transient = new Set(["sessions", "verifications", "oauth_access_tokens", "thought_ai_limits"]);
      const keys = {};
      for (const table of tables) {
        if (transient.has(table.name)) continue;
        const rows = (await client.query(`SELECT jsonb_build_array(${table.columns.map(quote).join(",")})::text AS key FROM public.${quote(table.name)} LIMIT 250001`)).rows;
        if (rows.length > 250000) throw new Error("Snapshot limit exceeded; arrange a reviewed large-data rollout.");
        keys[table.name] = rows.map((row) => hash(row.key));
      }
      // Direct projects and delivery checklist entries currently live inside JSON, not separate rows.
      keys.direct_projects = [];
      keys.delivery_checklist = [];
      const organisations = (await client.query("SELECT id, settings->'directProjects' AS projects FROM organisations")).rows;
      for (const org of organisations) {
        for (const project of org.projects ?? []) {
          keys.direct_projects.push(hash(`${org.id}:${project.id}`));
          for (const task of project.delivery?.tasks ?? []) keys.delivery_checklist.push(hash(`direct:${org.id}:${project.id}:${task.id}`));
        }
      }
      const opportunities = (await client.query("SELECT id, delivery->'tasks' AS tasks FROM opportunities")).rows;
      for (const opportunity of opportunities) {
        for (const task of opportunity.tasks ?? []) keys.delivery_checklist.push(hash(`opportunity:${opportunity.id}:${task.id}`));
      }
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({ migrations, keys }));
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Read-only database verification failed."); process.exitCode = 1; });
