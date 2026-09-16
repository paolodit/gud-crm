import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteThoughtStore } from "./thoughts-sqlite";
import { thoughtContentSchema, type ThoughtExploration } from "@/lib/domain/thoughts";

const alice = { id: "alice", organisationId: "00000000-0000-4000-8000-000000000001" };
const bob = { ...alice, id: "bob", role: "admin" };
const otherOrg = { ...alice, organisationId: "00000000-0000-4000-8000-000000000002" };
const connections: Database.Database[] = [];
function fixture() { const db = new Database(":memory:"); connections.push(db); return { db, store: createSqliteThoughtStore(db) }; }
afterEach(() => connections.splice(0).forEach((db) => db.close()));
describe("private Thoughts storage", () => {
  it("isolates reads and writes by both user and organisation, without admin overrides", () => {
    const { store } = fixture();
    const note = store.save(alice, { content: { body: "My private idea" } });
    expect(store.list(alice)).toHaveLength(1);
    for (const actor of [bob, otherOrg]) {
      expect(store.list(actor)).toEqual([]);
      expect(() => store.get(actor, note.id)).toThrow("unavailable");
      expect(() => store.save(actor, { id: note.id, version: note.version, content: { body: "Overwrite" } })).toThrow("unavailable");
    }
    expect(store.get(alice, note.id).body).toBe("My private idea");
  });
  it("preserves the current note when a stale tab tries to save", () => {
    const { store } = fixture();
    const note = store.save(alice, { content: { body: "First" } });
    store.save(alice, { id: note.id, version: note.version, content: { body: "Second", x: 340, y: 65 } });
    expect(() => store.save(alice, { id: note.id, version: note.version, content: { body: "Stale" } })).toThrow("another tab");
    expect(store.get(alice, note.id)).toMatchObject({ body: "Second", x: 340, y: 65, version: 2 });
  });
  it("keeps multiple explorations separate, private and available after archive/restore", () => {
    const { store, db } = fixture();
    const note = store.save(alice, { content: { body: "Small note" } });
    const document: ThoughtExploration = { id: crypto.randomUUID(), thoughtId: note.id, thoughtVersion: 1, thoughtTitle: "Small note", title: "More detail", body: "A much longer exploration", sources: [], origin: "outline", researched: false, createdAt: new Date().toISOString() };
    expect(() => store.append(bob, document)).toThrow("unavailable");
    store.append(alice, document); store.append(alice, { ...document, id: crypto.randomUUID() });
    expect(store.explorations(bob)).toEqual([]); expect(store.explorations(otherOrg)).toEqual([]);
    expect(store.explorations(alice)).toHaveLength(2);
    expect(store.get(alice, note.id).body).toBe("Small note");
    const archived = store.save(alice, { id: note.id, version: 1, content: thoughtContentSchema.parse({ body: note.body }), archived: true });
    expect(archived.archived).toBe(true);
    expect(store.save(alice, { id: note.id, version: 2, content: { body: note.body }, archived: false }).archived).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'local_%'").all()).toEqual([]);
  });
  it("limits exploration requests without putting personal content in CRM audits", () => {
    const { store } = fixture();
    expect(store.reserve(alice, 1)).toBe(true); expect(store.reserve(alice, 1)).toBe(false);
    expect(store.reserve(bob, 1)).toBe(true);
  });
});
