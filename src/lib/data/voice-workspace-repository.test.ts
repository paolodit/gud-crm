import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { deliveryDetails } from "@/lib/domain/delivery";
import type { VoiceChanges, VoiceTarget } from "@/lib/domain/voice-workspace";
import type { CurrentMember } from "@/lib/session";
import { getLocalAuditEvent, getLocalBoardSnapshot, updateLocalBoardSnapshot } from "./local-store";
import { applyVoicePlan, prepareVoicePlan, recoverVoicePlan, undoVoicePlan } from "./voice-workspace-repository";

vi.mock("@/db", () => ({ db: { transaction: vi.fn(), select: vi.fn() } }));
const actor: CurrentMember = { id: "voice-test-user", name: "Voice Test", email: "voice@example.com", organisationId: "00000000-0000-4000-8000-000000000001", role: "member", storageMode: "sqlite", demoMode: false };
const globalDb = globalThis as unknown as { gudLocalDb?: Database.Database };
let memory: Database.Database;
let target: VoiceTarget;
let changes: VoiceChanges;
beforeEach(() => {
  memory = new Database(":memory:");
  memory.exec("CREATE TABLE local_workspaces (id TEXT PRIMARY KEY, snapshot_json TEXT, updated_at TEXT); CREATE TABLE local_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); CREATE TABLE local_audit_events (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, detail_json TEXT, created_at TEXT);");
  memory.prepare("INSERT INTO local_settings VALUES ('snapshot_version', '15', ?)").run(new Date().toISOString());
  const snapshot = demoBoardForEdition("service");
  snapshot.users.push({ id: actor.id, name: actor.name });
  snapshot.opportunities[0].owner = null;
  memory.prepare("INSERT INTO local_workspaces VALUES ('default', ?, ?)").run(JSON.stringify(snapshot), new Date().toISOString());
  globalDb.gudLocalDb = memory;
  target = { kind: "sales", id: snapshot.opportunities[0].id };
  changes = { salesValue: 18500.25, temperature: "hot", activity: { typeId: snapshot.activityTypes.find((item) => item.channel === "note")!.id, notes: "The outline was approved.", outcome: "Approved", occurredAt: "2026-01-01T10:00:00.000Z" }, task: { title: "Send the proposal", dueAt: "2026-10-01T10:00:00.000Z" } };
});
afterEach(() => { vi.useRealTimers(); delete globalDb.gudLocalDb; memory.close(); });

describe("voice transaction journal (real in-memory SQLite)", () => {
  it("prepares without changing CRM data, applies once, and undoes once", async () => {
    const before = getLocalBoardSnapshot().opportunities[0];
    const plan = await prepareVoicePlan(actor, target, changes);
    expect(getLocalBoardSnapshot().opportunities[0]).toEqual(before);
    const receipt = await applyVoicePlan(actor, plan.id, changes);
    const saved = getLocalBoardSnapshot().opportunities[0];
    expect(saved.expectedValue).toBe(18500.25);
    expect(saved.activities.length).toBe(before.activities.length + 1);
    expect(saved.tasks.length).toBe(before.tasks.length + 1);
    expect(await applyVoicePlan(actor, plan.id, changes)).toEqual(expect.objectContaining({ id: receipt.id }));
    expect(getLocalBoardSnapshot().opportunities[0].activities.length).toBe(saved.activities.length);
    await undoVoicePlan(actor, receipt.id);
    const restored = getLocalBoardSnapshot().opportunities[0];
    expect(restored.expectedValue).toBe(before.expectedValue ?? null);
    expect(restored.activities).toEqual([...before.activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
    expect(restored.tasks).toEqual(before.tasks);
    await undoVoicePlan(actor, receipt.id);
    expect(getLocalBoardSnapshot().opportunities[0]).toEqual(restored);
    await expect(applyVoicePlan(actor, plan.id, changes)).rejects.toThrow("already been undone");
  });
  it("rolls back every record change when writing the receipt fails", async () => {
    const plan = await prepareVoicePlan(actor, target, changes);
    const before = getLocalBoardSnapshot().opportunities;
    memory.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON local_audit_events WHEN NEW.action = 'voice.applied' BEGIN SELECT RAISE(ABORT, 'Receipt test failure'); END;");
    await expect(applyVoicePlan(actor, plan.id, changes)).rejects.toThrow("Receipt test failure");
    expect(getLocalBoardSnapshot().opportunities).toEqual(before);
    expect(getLocalAuditEvent(plan.receiptId)).toBeNull();
    memory.exec("DROP TRIGGER reject_receipt");
    await expect(applyVoicePlan(actor, plan.id, changes)).resolves.toHaveProperty("id", plan.receiptId);
  });
  it("recovers whether an interrupted save was applied, undone, pending or expired", async () => {
    vi.useFakeTimers();
    const plan = await prepareVoicePlan(actor, target, changes);
    expect((await recoverVoicePlan(actor, plan.id)).status).toBe("review");
    const receipt = await applyVoicePlan(actor, plan.id, changes);
    expect(await recoverVoicePlan(actor, plan.id)).toEqual({ status: "applied", receipt: expect.objectContaining({ id: receipt.id }) });
    await undoVoicePlan(actor, receipt.id);
    expect(await recoverVoicePlan(actor, plan.id)).toEqual({ status: "undone" });
    const pending = await prepareVoicePlan(actor, target, changes);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(await recoverVoicePlan(actor, pending.id)).toEqual({ status: "expired" });
  });
  it("binds both review and undo to the original member and workspace", async () => {
    const plan = await prepareVoicePlan(actor, target, changes);
    for (const other of [{ ...actor, id: "other-user" }, { ...actor, organisationId: "other-workspace" }]) await expect(applyVoicePlan(other, plan.id, changes)).rejects.toThrow("not found");
    const receipt = await applyVoicePlan(actor, plan.id, changes);
    for (const other of [{ ...actor, id: "other-user" }, { ...actor, organisationId: "other-workspace" }]) await expect(undoVoicePlan(other, receipt.id)).rejects.toThrow("not found");
  });
  it("rejects stale fields, archived records and injected actions", async () => {
    const plan = await prepareVoicePlan(actor, target, changes);
    updateLocalBoardSnapshot((snapshot) => { snapshot.opportunities[0].expectedValue = 888; });
    await expect(applyVoicePlan(actor, plan.id, changes)).rejects.toThrow("changed since");
    await expect(applyVoicePlan(actor, plan.id, { ...changes, archivedAt: new Date().toISOString() })).rejects.toThrow();
    updateLocalBoardSnapshot((snapshot) => { snapshot.opportunities[0].archivedAt = new Date().toISOString(); });
    await expect(applyVoicePlan(actor, plan.id, changes)).rejects.toThrow("no longer available");
    expect(getLocalAuditEvent(plan.receiptId)).toBeNull();
  });
  it("rejects an expired review and expired Undo, but permits a retry after a successful save", async () => {
    vi.useFakeTimers();
    const plan = await prepareVoicePlan(actor, target, changes);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await expect(applyVoicePlan(actor, plan.id, changes)).rejects.toThrow("expired");
    const fresh = await prepareVoicePlan(actor, target, changes);
    const receipt = await applyVoicePlan(actor, fresh.id, changes);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await applyVoicePlan(actor, fresh.id, changes)).id).toBe(receipt.id);
    await expect(undoVoicePlan(actor, receipt.id)).rejects.toThrow("Undo window");
  });
  it("does not remove a task that has been completed or partly undo the other changes", async () => {
    const plan = await prepareVoicePlan(actor, target, changes);
    const receipt = await applyVoicePlan(actor, plan.id, changes);
    updateLocalBoardSnapshot((snapshot) => { snapshot.opportunities[0].tasks.find((task) => task.id === receipt.task!.id)!.status = "completed"; });
    const before = getLocalBoardSnapshot().opportunities;
    await expect(undoVoicePlan(actor, receipt.id)).rejects.toThrow("completed");
    expect(getLocalBoardSnapshot().opportunities).toEqual(before);
  });
  it("updates and undoes a direct project without changing sales records", async () => {
    const id = crypto.randomUUID();
    updateLocalBoardSnapshot((snapshot) => { snapshot.directProjects = [{ id, title: "Project", companyName: "Client", ownerId: null, offerId: null, delivery: deliveryDetails({ projectValue: 700, notes: "Existing brief" }) }]; });
    const sales = getLocalBoardSnapshot().opportunities;
    const direct: VoiceTarget = { kind: "direct", id };
    const edits = { deliveryValue: 0, deliveryStage: "in_progress", milestone: "First draft", milestoneDate: "2026-10-01", deliveryNote: "Design approved" };
    const plan = await prepareVoicePlan(actor, direct, edits);
    const receipt = await applyVoicePlan(actor, plan.id, edits);
    expect(getLocalBoardSnapshot().directProjects?.[0].delivery.notes).toBe("Existing brief\n\nDesign approved");
    expect(getLocalBoardSnapshot().opportunities).toEqual(sales);
    await undoVoicePlan(actor, receipt.id);
    expect(getLocalBoardSnapshot().directProjects?.[0].delivery.projectValue).toBe(700);
    expect(getLocalBoardSnapshot().directProjects?.[0].delivery.notes).toBe("Existing brief");
    await expect(prepareVoicePlan(actor, direct, changes)).rejects.toThrow();
  });
});
