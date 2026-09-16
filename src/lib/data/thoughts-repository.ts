import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { personalThoughts, thoughtExplorations, thoughtAiLimits } from "@/db/schema";
import { env } from "@/lib/env";
import { localDatabaseForPrivateData } from "./local-store";
import { createSqliteThoughtStore } from "./thoughts-sqlite";
import { assertPrivateThoughtAccess, explorationDocumentSchema, thoughtLabel, thoughtWriteSchema, ThoughtsError, unavailableThought, type Thought, type ThoughtActor, type ThoughtExploration } from "@/lib/domain/thoughts";

function check(actor: ThoughtActor) {
  assertPrivateThoughtAccess({ demoMode: env.demoMode, publicDemo: env.publicDemo });
  z.object({ id: z.string().min(1), organisationId: z.uuid() }).parse(actor);
}
const local = () => createSqliteThoughtStore(localDatabaseForPrivateData());
const owned = (actor: ThoughtActor) => and(eq(personalThoughts.organisationId, actor.organisationId), eq(personalThoughts.ownerId, actor.id));
function noteFromRow(row: typeof personalThoughts.$inferSelect): Thought {
  return { ...row.content, id: row.id, version: row.version, archived: row.archived, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function listThoughts(actor: ThoughtActor) {
  check(actor);
  if (env.sqliteMode) return local().list(actor);
  return (await db.select().from(personalThoughts).where(owned(actor)).orderBy(personalThoughts.createdAt)).map(noteFromRow);
}
export async function getThought(actor: ThoughtActor, id: string): Promise<Thought> {
  check(actor); z.uuid().parse(id);
  if (env.sqliteMode) return local().get(actor, id);
  const [row] = await db.select().from(personalThoughts).where(and(owned(actor), eq(personalThoughts.id, id))).limit(1);
  if (!row) throw unavailableThought();
  return noteFromRow(row);
}
export async function saveThought(actor: ThoughtActor, input: unknown): Promise<Thought> {
  check(actor);
  const value = thoughtWriteSchema.parse(input);
  if (env.sqliteMode) return local().save(actor, value);
  if (!value.id) {
    const [row] = await db.insert(personalThoughts).values({ organisationId: actor.organisationId, ownerId: actor.id, content: value.content, archived: value.archived }).returning();
    return noteFromRow(row);
  }
  const current = await getThought(actor, value.id);
  if (current.version !== value.version) throw new ThoughtsError("This thought changed in another tab. Reload before saving; your draft is still here.");
  const [row] = await db.update(personalThoughts).set({ content: value.content, archived: value.archived, version: current.version + 1, updatedAt: new Date() }).where(and(owned(actor), eq(personalThoughts.id, current.id), eq(personalThoughts.version, current.version))).returning();
  if (!row) throw new ThoughtsError("This thought changed in another tab. Reload before saving; your draft is still here.");
  return noteFromRow(row);
}
export async function listThoughtExplorations(actor: ThoughtActor): Promise<ThoughtExploration[]> {
  check(actor);
  if (env.sqliteMode) return local().explorations(actor);
  return (await db.select({ document: thoughtExplorations.document }).from(thoughtExplorations).where(and(eq(thoughtExplorations.organisationId, actor.organisationId), eq(thoughtExplorations.ownerId, actor.id))).orderBy(desc(thoughtExplorations.createdAt))).map((row) => row.document);
}
export async function appendThoughtExploration(actor: ThoughtActor, thoughtId: string, input: unknown, origin: ThoughtExploration["origin"], researched = false, snapshot?: Thought) {
  check(actor);
  const current = await getThought(actor, thoughtId);
  // Recheck ownership after generation; capture the version that was actually explored.
  const note = snapshot?.id === current.id ? snapshot : current;
  const value = explorationDocumentSchema.parse(input);
  const document: ThoughtExploration = { ...value, id: crypto.randomUUID(), thoughtId, thoughtVersion: note.version, thoughtTitle: thoughtLabel(note), origin, researched, createdAt: new Date().toISOString() };
  if (env.sqliteMode) return local().append(actor, document);
  await db.insert(thoughtExplorations).values({ id: document.id, thoughtId, organisationId: actor.organisationId, ownerId: actor.id, document });
  return document;
}
export async function reserveThoughtExploration(actor: ThoughtActor) {
  check(actor);
  if (env.sqliteMode) return local().reserve(actor, env.AI_RATE_LIMIT);
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx.insert(thoughtAiLimits).values({ ownerId: actor.id, windowStartedAt: now, requestCount: 0 }).onConflictDoNothing();
    const [row] = await tx.select().from(thoughtAiLimits).where(eq(thoughtAiLimits.ownerId, actor.id)).for("update");
    const reset = now.getTime() - row.windowStartedAt.getTime() >= 900000;
    if (!reset && row.requestCount >= env.AI_RATE_LIMIT) return false;
    await tx.update(thoughtAiLimits).set({ windowStartedAt: reset ? now : row.windowStartedAt, requestCount: reset ? 1 : row.requestCount + 1 }).where(eq(thoughtAiLimits.ownerId, actor.id));
    return true;
  });
}
