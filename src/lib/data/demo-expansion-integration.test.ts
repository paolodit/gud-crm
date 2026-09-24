import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { directProjectSchema, deliverySchema } from "@/lib/domain/delivery";

const url = process.env.GUD_THOUGHTS_TEST_DATABASE_URL;
describe.skipIf(!url)("additive demo examples on disposable PostgreSQL", () => {
  it("guards the database, previews, preserves existing data and is idempotent", async () => {
    if (!url || !new URL(url).pathname.endsWith("_release_test")) throw Error("Disposable release-test database required");
    const pool = new Pool({ connectionString: url, max: 1 });
    const org = randomUUID(), user = randomUUID(), pipeline = randomUUID();
    const existingProject = { id: randomUUID(), title: "Keep existing project", companyName: "Keep company", ownerId: user, offerId: null, delivery: { stage: "kickoff", dueDate: null, nextMilestone: "Keep milestone", notes: "Keep notes" } };
    try {
      const sql = await readFile("scripts/maintenance/demo-expand-workspace.sql", "utf8");
      await expect(pool.query(sql)).rejects.toThrow("restricted to gud_demo");
      await pool.query("ROLLBACK");
      // Only this test copy changes the guard; the operational source accepts gud_demo alone.
      const database = new URL(url).pathname.slice(1);
      if (!/^[a-z0-9_]+$/.test(database)) throw Error("Unsafe fixture name");
      const preview = sql.replace("current_database() <> 'gud_demo'", `current_database() <> '${database}'`);
      const apply = preview.replace(/ROLLBACK;\s*$/, "COMMIT;");
      await pool.query("INSERT INTO organisations(id,name,settings) VALUES ($1,'GUD CRM Demo',$2)", [org, { unrelated: "preserve", directProjects: [existingProject] }]);
      await pool.query("INSERT INTO users(id,organisation_id,name,email,role) VALUES($1,$2,'Demo admin',$3,'admin')", [user, org, `${user}@fixture.test`]);
      await pool.query("INSERT INTO pipelines(id,organisation_id,name) VALUES($1,$2,'Demo pipeline')", [pipeline, org]);
      for (const [index, name] of ["Outreach active", "Conversation active", "Proposal / decision", "Gone Cold", "Won"].entries()) {
        await pool.query("INSERT INTO stages(pipeline_id,name,colour,position) VALUES($1,$2,'#123456',$3)", [pipeline, name, index]);
      }
      for (const name of ["Website project", "Growth retainer", "Visitor experience"]) {
        await pool.query("INSERT INTO offers(organisation_id,name,normalised_name,colour) VALUES($1,$2,$3,'#123456')", [org, name, name.toLowerCase()]);
      }
      await pool.query("INSERT INTO activity_types(organisation_id,name,channel,icon,colour) VALUES($1,'Note','note','note','#123456')", [org]);
      await pool.query("INSERT INTO companies(organisation_id,name,normalised_name) VALUES($1,'Existing company','existing company')", [org]);
      const oldCompanies = (await pool.query("SELECT to_jsonb(c) AS value FROM companies c WHERE organisation_id=$1", [org])).rows;
      await pool.query(preview);
      expect((await pool.query("SELECT count(*)::int AS n FROM opportunities WHERE organisation_id=$1", [org])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT settings FROM organisations WHERE id=$1", [org])).rows[0].settings).toEqual({ unrelated: "preserve", directProjects: [existingProject] });
      await pool.query(apply);
      const settings = (await pool.query("SELECT settings FROM organisations WHERE id=$1", [org])).rows[0].settings;
      expect(settings.unrelated).toBe("preserve");
      expect(settings.directProjects).toHaveLength(6);
      expect(settings.directProjects[0]).toEqual(existingProject);
      for (const project of settings.directProjects) expect(directProjectSchema.safeParse(project).success).toBe(true);
      const records = (await pool.query("SELECT * FROM opportunities WHERE organisation_id=$1 ORDER BY id", [org])).rows;
      expect(records).toHaveLength(13);
      expect(records.filter(r => r.delivery)).toHaveLength(3);
      for (const record of records.filter(r => r.delivery)) expect(deliverySchema.safeParse(record.delivery).success).toBe(true);
      expect((await pool.query("SELECT count(*)::int AS n FROM tasks WHERE organisation_id=$1", [org])).rows[0].n).toBe(10);
      expect((await pool.query("SELECT to_jsonb(c) AS value FROM companies c WHERE organisation_id=$1 AND name='Existing company'", [org])).rows).toEqual(oldCompanies);
      await pool.query(apply);
      expect((await pool.query("SELECT settings FROM organisations WHERE id=$1", [org])).rows[0].settings).toEqual(settings);
      expect((await pool.query("SELECT * FROM opportunities WHERE organisation_id=$1 ORDER BY id", [org])).rows).toEqual(records);
    } finally {
      await pool.query("ROLLBACK");
      // Keep this disposable fixture for inspection; avoid cascading cleanup through restrictive FKs.
      await pool.query("UPDATE organisations SET name=$2 WHERE id=$1", [org, `Completed demo expansion fixture ${org}`]);
      await pool.end();
    }
  });
});
