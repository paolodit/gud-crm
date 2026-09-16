import type Database from "better-sqlite3";
import { nextThoughtPosition } from "@/lib/domain/thought-placement";
import { thoughtWriteSchema, unavailableThought, ThoughtsError, type Thought, type ThoughtActor, type ThoughtExploration } from "@/lib/domain/thoughts";

/** Separate tables: never included in the shared workspace snapshot or CRM export. */
export function createSqliteThoughtStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_thoughts (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, owner_id TEXT NOT NULL, document TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS personal_thoughts_owner_idx ON personal_thoughts (organisation_id, owner_id);
    CREATE TABLE IF NOT EXISTS thought_explorations (id TEXT PRIMARY KEY, thought_id TEXT NOT NULL REFERENCES personal_thoughts(id) ON DELETE CASCADE, organisation_id TEXT NOT NULL, owner_id TEXT NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS thought_explorations_owner_idx ON thought_explorations (organisation_id, owner_id);
    CREATE TABLE IF NOT EXISTS thought_ai_limits (owner_id TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, request_count INTEGER NOT NULL);
  `);
  const scope = (actor: ThoughtActor) => [actor.organisationId, actor.id];
  function get(actor: ThoughtActor, id: string): Thought {
    const row = db.prepare("SELECT document FROM personal_thoughts WHERE organisation_id = ? AND owner_id = ? AND id = ?").get(...scope(actor), id) as { document: string } | undefined;
    if (!row) throw unavailableThought();
    return JSON.parse(row.document);
  }
  return {
    get,
    list(actor: ThoughtActor): Thought[] {
      return (db.prepare("SELECT document FROM personal_thoughts WHERE organisation_id = ? AND owner_id = ? ORDER BY rowid").all(...scope(actor)) as { document: string }[]).map((row) => JSON.parse(row.document));
    },
    save: db.transaction((actor: ThoughtActor, input: unknown): Thought => {
      const value = thoughtWriteSchema.parse(input);
      const current = value.id ? get(actor, value.id) : null;
      if (current && current.version !== value.version) throw new ThoughtsError("This thought changed in another tab. Reload before saving; your draft is still here.");
      const now = new Date().toISOString();
      if (!current) {
        const existing = (db.prepare("SELECT document FROM personal_thoughts WHERE organisation_id = ? AND owner_id = ?").all(...scope(actor)) as { document: string }[]).map(row => JSON.parse(row.document) as Thought);
        Object.assign(value.content, nextThoughtPosition(existing, value.content));
      }
      const note: Thought = { ...value.content, id: current?.id ?? crypto.randomUUID(), version: (current?.version ?? 0) + 1, archived: value.archived, createdAt: current?.createdAt ?? now, updatedAt: now };
      if (current) db.prepare("UPDATE personal_thoughts SET document = ?, version = ? WHERE organisation_id = ? AND owner_id = ? AND id = ? AND version = ?").run(JSON.stringify(note), note.version, ...scope(actor), note.id, current.version);
      else db.prepare("INSERT INTO personal_thoughts (id, organisation_id, owner_id, document, version) VALUES (?, ?, ?, ?, ?)").run(note.id, ...scope(actor), JSON.stringify(note), note.version);
      return note;
    }),
    explorations(actor: ThoughtActor): ThoughtExploration[] {
      return (db.prepare("SELECT document FROM thought_explorations WHERE organisation_id = ? AND owner_id = ? ORDER BY rowid DESC").all(...scope(actor)) as { document: string }[]).map((row) => JSON.parse(row.document));
    },
    append: db.transaction((actor: ThoughtActor, document: ThoughtExploration) => {
      get(actor, document.thoughtId);
      db.prepare("INSERT INTO thought_explorations (id, thought_id, organisation_id, owner_id, document) VALUES (?, ?, ?, ?, ?)").run(document.id, document.thoughtId, ...scope(actor), JSON.stringify(document));
      return document;
    }),
    reserve: db.transaction((actor: ThoughtActor, limit: number) => {
      const key = `${actor.organisationId}:${actor.id}`;
      const now = Date.now();
      const row = db.prepare("SELECT window_started_at, request_count FROM thought_ai_limits WHERE owner_id = ?").get(key) as { window_started_at: number; request_count: number } | undefined;
      if (row && now - row.window_started_at < 900000 && row.request_count >= limit) return false;
      const reset = !row || now - row.window_started_at >= 900000;
      db.prepare("INSERT INTO thought_ai_limits (owner_id, window_started_at, request_count) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = excluded.request_count").run(key, reset ? now : row.window_started_at, reset ? 1 : row.request_count + 1);
      return true;
    }),
  };
}
