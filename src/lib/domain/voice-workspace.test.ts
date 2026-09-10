import { describe, expect, it } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { voiceContextFromSnapshot } from "@/lib/data/voice-workspace-repository";
import { applyVoiceChanges, assertVoiceChanges, undoVoiceChanges, voiceChangesSchema, voiceIsoToLocal, voiceLocalToIso, type VoiceChanges, type VoicePlan } from "./voice-workspace";

const now = new Date("2026-07-01T10:00:00Z");
function setup(kind: "sales" | "delivery" = "sales") {
  const snapshot = demoBoardForEdition("service");
  const opportunity = snapshot.opportunities[0];
  if (kind === "delivery") opportunity.stageId = snapshot.stages.find((item) => item.terminalType === "won")!.id;
  const context = voiceContextFromSnapshot(snapshot, { kind, id: opportunity.id });
  const plan = (changes: VoiceChanges): VoicePlan => ({ id: crypto.randomUUID(), receiptId: crypto.randomUUID(), undoId: crypto.randomUUID(), target: context.record.target, companyName: context.record.companyName, title: context.record.title, changes, before: context.record.fields, createdAt: now.toISOString(), expiresAt: "2026-10-10T11:00:00Z", taskDateHint: null });
  return { context, plan };
}

describe("combined voice changes", () => {
  it("applies sales, an activity and a next action without changing the input", () => {
    const { context, plan } = setup();
    const before = structuredClone(context);
    const changes: VoiceChanges = { salesValue: 12345.67, temperature: "warm", activity: { typeId: context.activityTypes[0].id, notes: "They approved the outline.", occurredAt: now.toISOString(), outcome: "Approved" }, task: { title: "Send the proposal", dueAt: "2026-10-12T10:00:00+01:00" } };
    const result = applyVoiceChanges(context, plan(changes), changes, { id: "actor" }, now);
    expect(context).toEqual(before);
    expect(result.record.fields.salesValue).toBe(12345.67);
    expect(result.record.tasks.at(-1)?.dueAt).toBe("2026-10-12T09:00:00.000Z");
    expect(result.record.activities.at(-1)?.notes).toBe("They approved the outline.");
    expect(result.receipt.expiresAt).toBe("2026-07-01T10:15:00.000Z");
  });
  it("keeps delivery value separate and appends notes", () => {
    const { context, plan } = setup("delivery");
    const changes = { deliveryValue: 0, deliveryStage: "client_review", deliveryNote: "Ready for review" };
    const result = applyVoiceChanges(context, plan(changes), changes, { id: "actor" }, now);
    expect(result.record.fields.deliveryValue).toBe(0);
    expect(result.record.fields.salesValue).toBe(context.record.fields.salesValue);
    expect(result.record.fields.deliveryNote).toBe([context.record.fields.deliveryNote, changes.deliveryNote].filter(Boolean).join("\n\n"));
  });
  it("allows corrected values and unchecked items but not unreviewed fields", () => {
    const { context, plan } = setup();
    const draft = plan({ salesValue: 10, priority: "high" });
    expect(applyVoiceChanges(context, draft, { salesValue: 20 }, { id: "a" }, now).record.fields.priority).toBe(context.record.fields.priority);
    expect(() => applyVoiceChanges(context, draft, { temperature: "hot" }, { id: "a" }, now)).toThrow("new review");
  });
  it("rejects a stale field and accepts unrelated newer work", () => {
    const { context, plan } = setup();
    const draft = plan({ salesValue: 10 });
    context.record.fields = { ...context.record.fields, temperature: "hot" };
    expect(applyVoiceChanges(context, draft, draft.changes, { id: "a" }, now).record.fields.temperature).toBe("hot");
    context.record.fields.salesValue = 50;
    expect(() => applyVoiceChanges(context, draft, draft.changes, { id: "a" }, now)).toThrow("changed since");
  });
  it("requires a due time and valid workspace references", () => {
    const { context, plan } = setup();
    const changes = { task: { title: "Send proposal", dueAt: null } };
    expect(() => assertVoiceChanges(context, changes)).not.toThrow();
    expect(() => applyVoiceChanges(context, plan(changes), changes, { id: "a" }, now)).toThrow("date and time");
    expect(() => assertVoiceChanges(context, { salesStage: crypto.randomUUID() })).toThrow("no longer available");
    expect(() => assertVoiceChanges(context, { activity: { typeId: crypto.randomUUID(), notes: "A note", outcome: null, occurredAt: now.toISOString() } })).toThrow("activity type");
  });
  it("enforces the selected record kind and money bounds", () => {
    expect(() => assertVoiceChanges(setup().context, { deliveryValue: 10 })).toThrow("live project");
    expect(() => assertVoiceChanges(setup("delivery").context, { salesValue: 10 })).toThrow("cannot change sales");
    for (const salesValue of [-1, 0.001, 10_000_000_000, Infinity]) expect(voiceChangesSchema.safeParse({ salesValue }).success).toBe(false);
    expect(voiceChangesSchema.safeParse({ archive: true }).success).toBe(false);
  });
  it("undoes only its created task and activity, preserving later work", () => {
    const { context, plan } = setup();
    const changes: VoiceChanges = { salesValue: 10, activity: { typeId: context.activityTypes[0].id, notes: "A useful note", outcome: null, occurredAt: now.toISOString() }, task: { title: "Next move", dueAt: now.toISOString() } };
    const { record, receipt } = applyVoiceChanges(context, plan(changes), changes, { id: "a" }, now);
    const later = { ...record.tasks.at(-1)!, id: crypto.randomUUID(), title: "Someone else's new task" };
    record.tasks.push(later); record.fields.temperature = "hot";
    const restored = undoVoiceChanges({ ...context, record }, receipt);
    expect(restored.tasks).toEqual([...context.record.tasks, later]);
    expect(restored.activities).toEqual(context.record.activities);
    expect(restored.fields.salesValue).toBe(context.record.fields.salesValue);
    expect(restored.fields.temperature).toBe("hot");
  });
  it("refuses Undo when a changed field or its task has been edited", () => {
    const { context, plan } = setup();
    const changes = { salesValue: 10, task: { title: "Next move", dueAt: now.toISOString() } };
    const result = applyVoiceChanges(context, plan(changes), changes, { id: "a" }, now);
    const record = structuredClone(result.record); record.fields.salesValue = 30;
    expect(() => undoVoiceChanges({ ...context, record }, result.receipt)).toThrow("newer work");
    result.record.tasks.at(-1)!.status = "completed";
    expect(() => undoVoiceChanges({ ...context, record: result.record }, result.receipt)).toThrow("completed");
  });
  it("compares receipt objects independently of JSONB key order", () => {
    const { context, plan } = setup();
    const changes = { task: { title: "Next move", dueAt: now.toISOString() } };
    const result = applyVoiceChanges(context, plan(changes), changes, { id: "a" }, now);
    result.receipt.task = Object.fromEntries(Object.entries(result.receipt.task!).reverse()) as typeof result.receipt.task;
    expect(() => undoVoiceChanges({ ...context, record: result.record }, result.receipt)).not.toThrow();
  });
});

describe("voice wall-clock dates", () => {
  it("handles London summer time, winter time and fractional-offset zones", () => {
    expect(voiceLocalToIso("2026-09-11T10:00", "Europe/London")).toBe("2026-09-11T09:00:00.000Z");
    expect(voiceLocalToIso("2026-12-11T10:00", "Europe/London")).toBe("2026-12-11T10:00:00.000Z");
    expect(voiceLocalToIso("2026-09-11T10:00", "Asia/Kolkata")).toBe("2026-09-11T04:30:00.000Z");
    expect(voiceIsoToLocal("2026-09-11T09:00:00Z", "Europe/London")).toBe("2026-09-11T10:00");
  });
  it("rejects impossible dates, a missing hour and an ambiguous repeated hour", () => {
    expect(voiceLocalToIso("2026-02-30T10:00", "Europe/London")).toBeNull();
    expect(voiceLocalToIso("2026-03-29T01:30", "Europe/London")).toBeNull();
    expect(voiceLocalToIso("2026-10-25T01:30", "Europe/London")).toBeNull();
  });
});
