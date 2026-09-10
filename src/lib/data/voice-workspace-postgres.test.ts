import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { activities, activityTypes, attachments, auditEvents, opportunities, organisations, stageHistory, stages, tasks } from "@/db/schema";
import { demoBoardForEdition } from "@/lib/demo-data";
import type { CurrentMember } from "@/lib/session";
import { applyVoicePlan, prepareVoicePlan, undoVoicePlan } from "./voice-workspace-repository";

vi.mock("@/db", () => ({ db: { transaction: vi.fn(), select: vi.fn() } }));
const actor: CurrentMember = { id: "member-pg", organisationId: "00000000-0000-4000-8000-000000000001", name: "PG Member", email: "pg@example.com", role: "member", storageMode: "postgres", demoMode: false };
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const demo = demoBoardForEdition("service");
  const opp = demo.opportunities[0];
  let state = {
    settings: { keepThis: "unrelated setting" },
    opportunity: { id: opp.id, organisationId: actor.organisationId, companyId: opp.company.id, pipelineId: demo.pipeline.id, ownerId: actor.id, offerId: opp.offer!.id, stageId: opp.stageId, title: opp.title, value: "500.00", priority: opp.priority, temperature: opp.temperature, delivery: null, archivedAt: null, noNextActionReason: "Old reason", updatedAt: new Date() } as Record<string, unknown>,
    events: [] as Array<Record<string, unknown>>, activities: [] as Array<Record<string, unknown>>, tasks: [] as Array<Record<string, unknown>>, history: [] as Array<Record<string, unknown>>, attachment: false,
  };
  const predicates: Array<{ sql: string; params: unknown[] }> = [];
  const locks: unknown[][] = [];
  let failReceipt = false;
  const select = () => ({ from: (table: unknown) => {
    const query = { innerJoin: () => query, where: (predicate: SQL) => {
      const parsed = new PgDialect().sqlToQuery(predicate); predicates.push(parsed);
      let rows: unknown[] = [];
      if (table === organisations) rows = parsed.params.includes(actor.organisationId) ? [{ id: actor.organisationId, settings: state.settings }] : [];
      if (table === opportunities) rows = parsed.params.includes(state.opportunity.id) && parsed.params.includes(actor.organisationId) ? [{ opportunity: structuredClone(state.opportunity), company: { ...opp.company, archivedAt: null } }] : [];
      if (table === stages) rows = demo.stages;
      if (table === activityTypes) rows = demo.activityTypes;
      if (table === activities) rows = structuredClone(state.activities);
      if (table === tasks) rows = structuredClone(state.tasks);
      if (table === auditEvents) rows = state.events.filter((event) => parsed.params.includes(event.id) && parsed.params.includes(event.organisationId) && parsed.params.includes(event.actorId)).map((event) => structuredClone(event));
      if (table === attachments) rows = state.attachment ? [{ id: crypto.randomUUID() }] : [];
      const result = Object.assign(Promise.resolve(rows), { limit: () => result, for: (...args: unknown[]) => { locks.push(args); return Promise.resolve(rows); } });
      return result;
    } };
    return query;
  } });
  const tx = { select, update: (table: unknown) => ({ set: (value: object) => ({ where: async (predicate: SQL) => {
    predicates.push(new PgDialect().sqlToQuery(predicate));
    if (table === opportunities) Object.assign(state.opportunity, value);
    if (table === organisations) Object.assign(state, value);
  } }) }), insert: (table: unknown) => ({ values: async (value: Record<string, unknown>) => {
    if (table === auditEvents) { if (failReceipt && value.action === "voice.applied") throw new Error("Journal write failed"); state.events.push(value); }
    if (table === activities) state.activities.push({ ...value, contactId: null, metadata: {} });
    if (table === tasks) state.tasks.push({ ...value, status: "open", contactId: null, completedAt: null });
    if (table === stageHistory) state.history.push(value);
  } }), delete: (table: unknown) => ({ where: async (predicate: SQL) => {
    const parsed = new PgDialect().sqlToQuery(predicate); predicates.push(parsed);
    if (table === activities) state.activities = state.activities.filter((item) => !parsed.params.includes(item.id));
    if (table === tasks) state.tasks = state.tasks.filter((item) => !parsed.params.includes(item.id));
  } }) };
  vi.mocked(db.select).mockImplementation(select as never);
  vi.mocked(db.transaction).mockImplementation(async (work) => {
    const before = structuredClone(state);
    try { return await work(tx as never); } catch (error) { state = before; throw error; }
  });
  return { get: () => state, predicates, locks, fail: () => { failReceipt = true; }, target: { kind: "sales" as const, id: opp.id }, changes: { salesStage: demo.stages.find((stage) => stage.terminalType === "won")!.id, salesValue: 15000.5, activity: { typeId: demo.activityTypes[0].id, notes: "A confirmed call", outcome: null, occurredAt: "2026-01-01T10:00:00.000Z" }, task: { title: "Next move", dueAt: "2026-10-16T10:00:00.000Z" } } };
}

describe("PostgreSQL voice persistence contract", () => {
  it("scopes every target and receipt read, locks records, and records reverse stage history on Undo", async () => {
    const f = fixture();
    const originalStage = f.get().opportunity.stageId;
    const plan = await prepareVoicePlan(actor, f.target, f.changes);
    const receipt = await applyVoicePlan(actor, plan.id, f.changes);
    expect(f.get().opportunity.value).toBe("15000.5");
    expect(f.get().activities).toHaveLength(1);
    expect(f.get().tasks).toHaveLength(1);
    expect(f.get().history).toHaveLength(1);
    expect((await applyVoicePlan(actor, plan.id, f.changes)).id).toBe(receipt.id);
    expect(f.get().activities).toHaveLength(1);
    await undoVoicePlan(actor, receipt.id);
    expect(f.get().opportunity.stageId).toBe(originalStage);
    expect(f.get().opportunity.value).toBe("500");
    expect(f.get().activities).toHaveLength(0);
    expect(f.get().tasks).toHaveLength(0);
    expect(f.get().history).toHaveLength(2);
    expect(f.get().settings).toEqual({ keepThis: "unrelated setting" });
    expect(f.locks.some((lock) => lock[0] === "update" && lock[1])).toBe(true);
    for (const predicate of f.predicates.filter((item) => /"opportunities"|"audit_events"|"tasks"|"activities"|"organisations"/.test(item.sql))) expect(predicate.params).toContain(actor.organisationId);
  });
  it("rolls back the entire group if its receipt cannot be saved", async () => {
    const f = fixture();
    const plan = await prepareVoicePlan(actor, f.target, f.changes);
    const before = structuredClone(f.get());
    f.fail();
    await expect(applyVoicePlan(actor, plan.id, f.changes)).rejects.toThrow("Journal write failed");
    expect(f.get()).toEqual(before);
  });
  it("rejects another tenant and refuses to undo an activity with a new attachment", async () => {
    const f = fixture();
    const plan = await prepareVoicePlan(actor, f.target, f.changes);
    await expect(applyVoicePlan({ ...actor, organisationId: "foreign-org" }, plan.id, f.changes)).rejects.toThrow("not found");
    const receipt = await applyVoicePlan(actor, plan.id, f.changes);
    f.get().attachment = true;
    const before = structuredClone(f.get());
    await expect(undoVoicePlan(actor, receipt.id)).rejects.toThrow("attachments");
    expect(f.get()).toEqual(before);
  });
});
