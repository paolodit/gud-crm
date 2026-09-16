import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(mock.query) };
});
vi.mock("@/lib/data/local-store", () => ({ localDatabaseForPrivateData: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { demoMode: false, publicDemo: false, sqliteMode: false } }));
import { appendThoughtExploration, getThought, listThoughtExplorations, listThoughts, saveThought } from "./thoughts-repository";
const actor = { id: "alice", organisationId: "00000000-0000-4000-8000-000000000001" };
const id = "00000000-0000-4000-8000-000000000002";
beforeEach(() => { mock.query.mockReset(); mock.query.mockResolvedValue({ rows: [] }); });
describe("PostgreSQL private query boundaries", () => {
  it("scopes both collections and individual records by organisation AND owner", async () => {
    await listThoughts(actor); await listThoughtExplorations(actor);
    await expect(getThought(actor, id)).rejects.toThrow("unavailable");
    for (const [sql, parameters] of mock.query.mock.calls) {
      expect(sql).toMatch(/where .*"organisation_id" = \$1 and .*"owner_id" = \$2/);
      expect(parameters.slice(0, 2)).toEqual([actor.organisationId, actor.id]);
    }
  });
  it("cannot update or append to another user's invisible record", async () => {
    await expect(saveThought(actor, { id, version: 1, content: { body: "No" } })).rejects.toThrow("unavailable");
    await expect(appendThoughtExploration(actor, id, { title: "No", body: "No" }, "mcp")).rejects.toThrow("unavailable");
    expect(mock.query.mock.calls.every(([sql]) => sql.startsWith("select"))).toBe(true);
  });
  it("includes owner, organisation and version predicates in the update itself", async () => {
    const time = "2026-09-15T10:00:00.000Z";
    mock.query.mockResolvedValueOnce({ rows: [[id, actor.organisationId, actor.id, { body: "Owned", title: "", checklist: [], category: "", colour: "butter", x: 32, y: 32 }, 1, false, time, time]] });
    await expect(saveThought(actor, { id, version: 1, content: { body: "Updated" } })).rejects.toThrow("another tab");
    const [sql, parameters] = mock.query.mock.calls[1];
    expect(sql).toMatch(/where .*"organisation_id" = .* and .*"owner_id" = .* and .*"id" = .* and .*"version" = /);
    expect(parameters.slice(-4)).toEqual([actor.organisationId, actor.id, id, 1]);
  });
});
