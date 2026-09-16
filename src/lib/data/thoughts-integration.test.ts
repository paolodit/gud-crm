import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.GUD_THOUGHTS_TEST_DATABASE_URL;
let pool: typeof import("@/db").pool;
let store: typeof import("./thoughts-repository");

describe.skipIf(!url)("real PostgreSQL Thoughts isolation", () => {
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith("_release_test")) throw new Error("Thoughts integration requires the disposable release-test database.");
    Object.assign(process.env, { DATABASE_URL: url, DATA_BACKEND: "postgres", GUD_PUBLIC_DEMO: "false", DEMO_MODE: "false", BETTER_AUTH_SECRET: "ci-only-thoughts-integration-secret-32-characters", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" });
    pool = (await import("@/db")).pool;
    store = await import("./thoughts-repository");
  });
  afterAll(async () => { await pool?.end(); });

  it("enforces ownership, organisation boundaries, versions and exploration history", async () => {
    const org = randomUUID(), otherOrg = randomUUID();
    const alice = { id: randomUUID(), organisationId: org };
    const admin = { id: randomUUID(), organisationId: org };
    const outsider = { id: randomUUID(), organisationId: otherOrg };
    await pool.query("INSERT INTO organisations (id,name) VALUES ($1,'Thoughts fixture'),($2,'Other fixture')", [org, otherOrg]);
    for (const [actor, role] of [[alice, "member"], [admin, "admin"], [outsider, "member"]] as const) {
      await pool.query("INSERT INTO users (id,organisation_id,name,email,role) VALUES ($1,$2,'Fixture',$3,$4)", [actor.id, actor.organisationId, `${actor.id}@fixture.test`, role]);
    }
    const note = await store.saveThought(alice, { content: { body: "Alice private fixture" } });
    expect((await store.listThoughts(alice)).map(n => n.id)).toEqual([note.id]);
    for (const actor of [admin, outsider, { ...alice, organisationId: otherOrg }]) {
      expect(await store.listThoughts(actor)).toEqual([]);
      await expect(store.getThought(actor, note.id)).rejects.toThrow("unavailable");
      await expect(store.saveThought(actor, { id: note.id, version: note.version, content: { body: "Wrong owner" } })).rejects.toThrow("unavailable");
      await expect(store.appendThoughtExploration(actor, note.id, { title: "Wrong owner", body: "No access" }, "mcp")).rejects.toThrow("unavailable");
    }
    const changed = await store.saveThought(alice, { id: note.id, version: note.version, content: { body: "Alice updated fixture" } });
    expect(changed.version).toBe(2);
    await expect(store.saveThought(alice, { id: note.id, version: 1, content: { body: "Stale" } })).rejects.toThrow("another tab");
    await store.appendThoughtExploration(alice, note.id, { title: "First exploration", body: "Private fixture" }, "outline");
    await store.appendThoughtExploration(alice, note.id, { title: "Second exploration", body: "Another private fixture" }, "mcp");
    expect(await store.listThoughtExplorations(alice)).toHaveLength(2);
    expect(await store.listThoughtExplorations(admin)).toEqual([]);
    expect(await store.listThoughtExplorations(outsider)).toEqual([]);
    expect((await store.getThought(alice, note.id)).body).toBe("Alice updated fixture");
  });
});
