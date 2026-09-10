import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, activityTypes, attachments, auditEvents, companies, opportunities, organisations, stageHistory, stages, tasks } from "@/db/schema";
import { configuredDeliveryStages, deliveryDetails, directProjects } from "@/lib/domain/delivery";
import { applyVoiceChanges, assertVoiceChanges, deliveryFromVoiceRecord, undoVoiceChanges, voiceChangesSchema, voiceFields, voiceTargetSchema, type VoiceContext, type VoicePlan, type VoiceReceipt, type VoiceRecord, type VoiceTarget } from "@/lib/domain/voice-workspace";
import type { BoardSnapshot } from "@/lib/domain/types";
import type { CurrentMember } from "@/lib/session";
import { getLocalAuditEvent, recordLocalAuditEvent, updateLocalBoardSnapshot } from "./local-store";

type Event = { id: string; actorId: string | null; action: string; entityId: string; detail: Record<string, unknown> };
type Store = {
  context: VoiceContext;
  event: (id: string) => Promise<Event | null>;
  addEvent: (event: Event) => Promise<void>;
  save: (record: VoiceRecord) => Promise<void>;
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const nowIso = () => new Date().toISOString();

export function voiceContextFromSnapshot(snapshot: BoardSnapshot, target: VoiceTarget): VoiceContext {
  const deliveryStages = configuredDeliveryStages(snapshot.deliveryStages);
  if (target.kind === "direct") {
    const project = directProjects(snapshot.directProjects).find((item) => item.id === target.id && !item.delivery.archivedAt);
    if (!project) throw new Error("This live project is no longer available.");
    return { salesStages: [], deliveryStages, activityTypes: snapshot.activityTypes, record: { target, companyName: project.companyName, title: project.title, companyId: null, ownerId: project.ownerId, offerId: project.offerId, fields: voiceFields({ delivery: project.delivery }), delivery: project.delivery, activities: [], tasks: [], noNextActionReason: null } };
  }
  const item = snapshot.opportunities.find((item) => item.id === target.id && !item.archivedAt && !item.company.archivedAt);
  if (!item) throw new Error("This sales record is no longer available.");
  const delivery = deliveryDetails(item.delivery ?? { stage: deliveryStages[0].id });
  if (target.kind === "delivery" && (delivery.archivedAt || !snapshot.stages.some((stage) => stage.id === item.stageId && stage.terminalType === "won"))) throw new Error("Choose a current, won project for a delivery update.");
  return {
    salesStages: snapshot.stages, deliveryStages, activityTypes: snapshot.activityTypes,
    record: {
      target, companyName: item.company.name, title: item.title, companyId: item.company.id, ownerId: item.owner?.id ?? null, offerId: item.offer?.id ?? null,
      fields: voiceFields({ ...item, delivery }), delivery, noNextActionReason: item.noNextActionReason,
      activities: item.activities.map((activity) => ({ id: activity.id, typeId: activity.type.id, notes: activity.notes, outcome: activity.outcome, occurredAt: activity.occurredAt, createdAt: activity.createdAt, createdById: activity.createdById ?? snapshot.users.find((user) => user.name === activity.createdBy)?.id ?? activity.createdBy, contactId: activity.contactId })),
      tasks: item.tasks.map((task) => ({ id: task.id, title: task.title, dueAt: task.dueAt, status: task.status, ownerId: task.owner?.id ?? null, contactId: task.contactId })),
    },
  };
}

function saveLocal(snapshot: BoardSnapshot, actor: CurrentMember, record: VoiceRecord) {
  if (record.target.kind === "direct") {
    snapshot.directProjects = directProjects(snapshot.directProjects).map((project) => project.id === record.target.id ? { ...project, delivery: deliveryFromVoiceRecord(record) } : project);
    return;
  }
  const item = snapshot.opportunities.find((item) => item.id === record.target.id)!;
  const activityChanged = item.activities.length !== record.activities.length || item.activities.some((entry) => !record.activities.some((next) => next.id === entry.id));
  const taskChanged = item.tasks.length !== record.tasks.length || item.tasks.some((entry) => !record.tasks.some((next) => next.id === entry.id));
  Object.assign(item, { stageId: record.fields.salesStage, expectedValue: record.fields.salesValue, priority: record.fields.priority, temperature: record.fields.temperature });
  if (record.target.kind === "delivery") item.delivery = deliveryFromVoiceRecord(record);
  item.activities = record.activities.map((activity) => {
    const existing = item.activities.find((entry) => entry.id === activity.id);
    return existing ?? { id: activity.id, type: snapshot.activityTypes.find((type) => type.id === activity.typeId)!, notes: activity.notes, outcome: activity.outcome, occurredAt: activity.occurredAt, createdAt: activity.createdAt, createdBy: actor.name, createdById: actor.id, contactId: null, contactName: null };
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  item.tasks = record.tasks.map((task) => item.tasks.find((entry) => entry.id === task.id) ?? { ...task, owner: snapshot.users.find((user) => user.id === task.ownerId) ?? { id: actor.id, name: actor.name } });
  if (activityChanged) { item.lastActivityAt = item.activities[0]?.occurredAt ?? null; item.recentChannels = [...new Set(item.activities.map((entry) => entry.type.channel))].slice(0, 4); }
  if (taskChanged) item.nextActionAt = item.tasks.filter((task) => task.status === "open").map((task) => task.dueAt).sort()[0] ?? null;
  item.noNextActionReason = record.noNextActionReason;
}

async function pgStore(tx: Tx, actor: CurrentMember, target: VoiceTarget, settings: Record<string, unknown>): Promise<Store> {
  const event = async (id: string) => {
    const [row] = await tx.select().from(auditEvents).where(and(eq(auditEvents.id, id), eq(auditEvents.organisationId, actor.organisationId), eq(auditEvents.actorId, actor.id))).limit(1);
    return row ? { id: row.id, actorId: row.actorId, action: row.action, entityId: row.entityId ?? "", detail: row.after ?? {} } : null;
  };
  const addEvent = async (entry: Event) => {
    await tx.insert(auditEvents).values({ id: entry.id, organisationId: actor.organisationId, actorId: actor.id, action: entry.action, entityType: "voice_update", entityId: entry.entityId, after: entry.detail });
  };
  const deliveryStages = configuredDeliveryStages(settings.deliveryStages);
  if (target.kind === "direct") {
    const projects = directProjects(settings.directProjects);
    const project = projects.find((item) => item.id === target.id && !item.delivery.archivedAt);
    if (!project) throw new Error("This live project is no longer available.");
    const context: VoiceContext = { salesStages: [], deliveryStages, activityTypes: [], record: { target, companyName: project.companyName, title: project.title, companyId: null, ownerId: project.ownerId, offerId: project.offerId, fields: voiceFields({ delivery: project.delivery }), delivery: project.delivery, activities: [], tasks: [], noNextActionReason: null } };
    return { context, event, addEvent, save: async (record) => {
      await tx.update(organisations).set({ settings: { ...settings, directProjects: projects.map((item) => item.id === target.id ? { ...item, delivery: deliveryFromVoiceRecord(record) } : item) } }).where(eq(organisations.id, actor.organisationId));
    } };
  }
  const [row] = await tx.select({ opportunity: opportunities, company: companies }).from(opportunities)
    .innerJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.organisationId, actor.organisationId)))
    .where(and(eq(opportunities.id, target.id), eq(opportunities.organisationId, actor.organisationId))).limit(1).for("update", { of: opportunities });
  if (!row || row.opportunity.archivedAt || row.company.archivedAt) throw new Error("This sales record is no longer available.");
  const item = row.opportunity;
  const stageRows = await tx.select().from(stages).where(and(eq(stages.pipelineId, item.pipelineId), eq(stages.active, true)));
  const typeRows = await tx.select().from(activityTypes).where(and(eq(activityTypes.organisationId, actor.organisationId), eq(activityTypes.active, true)));
  const activityRows = await tx.select().from(activities).where(and(eq(activities.opportunityId, item.id), eq(activities.organisationId, actor.organisationId))).for("update");
  const taskRows = await tx.select().from(tasks).where(and(eq(tasks.opportunityId, item.id), eq(tasks.organisationId, actor.organisationId))).for("update");
  const delivery = deliveryDetails(item.delivery ?? { stage: deliveryStages[0].id });
  if (target.kind === "delivery" && (delivery.archivedAt || !stageRows.some((stage) => stage.id === item.stageId && stage.terminalType === "won"))) throw new Error("Choose a current, won project for a delivery update.");
  const record: VoiceRecord = {
    target, companyName: row.company.name, title: item.title, companyId: item.companyId, ownerId: item.ownerId, offerId: item.offerId,
    fields: voiceFields({ stageId: item.stageId, expectedValue: item.value === null ? null : Number(item.value), priority: item.priority, temperature: item.temperature, delivery }), delivery, noNextActionReason: item.noNextActionReason,
    activities: activityRows.map((entry) => ({ id: entry.id, typeId: entry.activityTypeId, notes: entry.notes, outcome: entry.outcome, occurredAt: entry.occurredAt.toISOString(), contactId: entry.contactId, createdById: entry.createdById, createdAt: entry.createdAt.toISOString() })),
    tasks: taskRows.map((entry) => ({ id: entry.id, title: entry.title, dueAt: entry.dueAt.toISOString(), status: entry.status, ownerId: entry.ownerId, contactId: entry.contactId })),
  };
  return { context: { record, salesStages: stageRows, deliveryStages, activityTypes: typeRows }, event, addEvent, save: async (next) => {
    for (const activity of next.activities.filter((entry) => !record.activities.some((old) => old.id === entry.id))) {
      await tx.insert(activities).values({ id: activity.id, organisationId: actor.organisationId, opportunityId: item.id, companyId: item.companyId, activityTypeId: activity.typeId, notes: activity.notes, outcome: activity.outcome, occurredAt: new Date(activity.occurredAt), createdAt: new Date(activity.createdAt), updatedAt: new Date(activity.createdAt), createdById: actor.id });
    }
    for (const activity of record.activities.filter((entry) => !next.activities.some((remaining) => remaining.id === entry.id))) {
      const original = activityRows.find((entry) => entry.id === activity.id)!;
      const linked = await tx.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.activityId, activity.id), eq(attachments.organisationId, actor.organisationId))).limit(1);
      if (linked.length || Object.keys(original.metadata).length || original.updatedAt.getTime() !== original.createdAt.getTime()) throw new Error("This activity has newer edits or attachments. Undo is no longer safe.");
      await tx.delete(activities).where(and(eq(activities.id, activity.id), eq(activities.organisationId, actor.organisationId), eq(activities.opportunityId, item.id)));
    }
    for (const task of next.tasks.filter((entry) => !record.tasks.some((old) => old.id === entry.id))) {
      await tx.insert(tasks).values({ id: task.id, organisationId: actor.organisationId, opportunityId: item.id, ownerId: task.ownerId, title: task.title, dueAt: new Date(task.dueAt), source: "voice_update" });
    }
    for (const task of record.tasks.filter((entry) => !next.tasks.some((remaining) => remaining.id === entry.id))) {
      if (taskRows.find((entry) => entry.id === task.id)?.completedAt) throw new Error("The next action has been completed. Undo is no longer safe.");
      await tx.delete(tasks).where(and(eq(tasks.id, task.id), eq(tasks.organisationId, actor.organisationId), eq(tasks.opportunityId, item.id)));
    }
    const last = next.activities.map((activity) => activity.occurredAt).sort().at(-1);
    const due = next.tasks.filter((task) => task.status === "open").map((task) => task.dueAt).sort()[0];
    const activityChanged = next.activities.length !== record.activities.length || record.activities.some((entry) => !next.activities.some((value) => value.id === entry.id));
    const taskChanged = next.tasks.length !== record.tasks.length || record.tasks.some((entry) => !next.tasks.some((value) => value.id === entry.id));
    await tx.update(opportunities).set({ stageId: next.fields.salesStage, value: next.fields.salesValue === null ? null : String(next.fields.salesValue), priority: next.fields.priority, temperature: next.fields.temperature,
      ...(target.kind === "delivery" ? { delivery: deliveryFromVoiceRecord(next) } : {}), ...(activityChanged ? { lastActivityAt: last ? new Date(last) : null } : {}), ...(taskChanged ? { nextActionAt: due ? new Date(due) : null } : {}), noNextActionReason: next.noNextActionReason, updatedAt: new Date() }).where(and(eq(opportunities.id, item.id), eq(opportunities.organisationId, actor.organisationId)));
    if (record.fields.salesStage !== next.fields.salesStage) await tx.insert(stageHistory).values({ opportunityId: item.id, fromStageId: record.fields.salesStage, toStageId: next.fields.salesStage, movedById: actor.id });
  } };
}

/** All record and receipt writes share one transaction. SQLite callbacks must stay synchronous. */
async function withStore<T>(actor: CurrentMember, target: VoiceTarget, work: (store: Store) => Promise<T>, localWork: (snapshot: BoardSnapshot) => T): Promise<T> {
  if (actor.storageMode === "demo") throw new Error("Use a saved workspace for voice updates.");
  if (actor.storageMode === "sqlite") return updateLocalBoardSnapshot(localWork);
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organisations).where(eq(organisations.id, actor.organisationId)).limit(1).for("update");
    if (!org) throw new Error("Workspace not found.");
    return work(await pgStore(tx, actor, target, org.settings));
  });
}

function localEvent(actor: CurrentMember, id: string) {
  const event = getLocalAuditEvent(id);
  return event?.actorId === actor.id && event.detail.organisationId === actor.organisationId ? event : null;
}
function addLocal(actor: CurrentMember, id: string, action: string, entityId: string, detail: object) {
  recordLocalAuditEvent({ id, actorId: actor.id, action, entityType: "voice_update", entityId, detail: { ...detail, organisationId: actor.organisationId } });
}
function readPlan(event: Event | null, actor: CurrentMember): VoicePlan {
  if (!event || event.actorId !== actor.id || event.action !== "voice.prepared") throw new Error("This voice review was not found. Prepare it again.");
  return event.detail as unknown as VoicePlan;
}
function checkExpiry(expiresAt: string, message: string) { if (Date.now() > Date.parse(expiresAt)) throw new Error(message); }
function assertReceiptEvent(event: Event | null, actor: CurrentMember): VoiceReceipt {
  if (!event || event.actorId !== actor.id || event.action !== "voice.applied") throw new Error("That voice update was not found.");
  return event.detail as unknown as VoiceReceipt;
}

// The target is taken from the server-side plan/receipt, never from Apply or Undo's payload.
async function readOwnedEvent(actor: CurrentMember, id: string): Promise<Event | null> {
  if (actor.storageMode === "sqlite") return localEvent(actor, id);
  if (actor.storageMode !== "postgres") return null;
  const [row] = await db.select().from(auditEvents).where(and(eq(auditEvents.id, id), eq(auditEvents.organisationId, actor.organisationId), eq(auditEvents.actorId, actor.id))).limit(1);
  return row ? { id: row.id, actorId: row.actorId, action: row.action, entityId: row.entityId ?? "", detail: row.after ?? {} } : null;
}

export async function prepareVoicePlan(actor: CurrentMember, target: VoiceTarget, changesInput: unknown, taskDateHint: string | null = null): Promise<VoicePlan> {
  voiceTargetSchema.parse(target);
  const changes = voiceChangesSchema.parse(changesInput);
  function make(context: VoiceContext): VoicePlan {
    assertVoiceChanges(context, changes);
    const now = new Date();
    return { id: crypto.randomUUID(), receiptId: crypto.randomUUID(), undoId: crypto.randomUUID(), target, companyName: context.record.companyName, title: context.record.title, before: context.record.fields, changes, taskDateHint, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString() };
  }
  return withStore(actor, target, async (store) => {
    const plan = make(store.context);
    await store.addEvent({ id: plan.id, actorId: actor.id, action: "voice.prepared", entityId: target.id, detail: plan as unknown as Record<string, unknown> });
    return plan;
  }, (snapshot) => { const plan = make(voiceContextFromSnapshot(snapshot, target)); addLocal(actor, plan.id, "voice.prepared", target.id, plan); return plan; });
}

export async function applyVoicePlan(actor: CurrentMember, planId: string, changesInput: unknown): Promise<VoiceReceipt> {
  const plan = readPlan(await readOwnedEvent(actor, planId), actor);
  const changes = voiceChangesSchema.parse(changesInput);
  const alreadyApplied = await readOwnedEvent(actor, plan.receiptId);
  if (alreadyApplied) {
    if (await readOwnedEvent(actor, plan.undoId)) throw new Error("This update has already been undone. Prepare a new review.");
    return assertReceiptEvent(alreadyApplied, actor);
  }
  return withStore(actor, plan.target, async (store) => {
    const existing = await store.event(plan.receiptId);
    if (existing) { if (await store.event(plan.undoId)) throw new Error("This update has already been undone. Prepare a new review."); return assertReceiptEvent(existing, actor); }
    checkExpiry(plan.expiresAt, "This review has expired. Prepare it again with the latest record.");
    const { record, receipt } = applyVoiceChanges(store.context, plan, changes, actor, new Date());
    await store.save(record);
    await store.addEvent({ id: receipt.id, actorId: actor.id, action: "voice.applied", entityId: plan.target.id, detail: receipt as unknown as Record<string, unknown> });
    return receipt;
  }, (snapshot) => {
    const existing = localEvent(actor, plan.receiptId);
    if (existing) { if (localEvent(actor, plan.undoId)) throw new Error("This update has already been undone. Prepare a new review."); return assertReceiptEvent(existing, actor); }
    checkExpiry(plan.expiresAt, "This review has expired. Prepare it again with the latest record.");
    const { record, receipt } = applyVoiceChanges(voiceContextFromSnapshot(snapshot, plan.target), plan, changes, actor, new Date());
    saveLocal(snapshot, actor, record); addLocal(actor, receipt.id, "voice.applied", plan.target.id, receipt); return receipt;
  });
}

export async function undoVoicePlan(actor: CurrentMember, receiptId: string) {
  const receipt = assertReceiptEvent(await readOwnedEvent(actor, receiptId), actor);
  if (await readOwnedEvent(actor, receipt.undoId)) return;
  const detail = { receiptId, undoneAt: nowIso() };
  return withStore(actor, receipt.target, async (store) => {
    if (await store.event(receipt.undoId)) return;
    checkExpiry(receipt.expiresAt, "The 15-minute Undo window has ended. You can still edit the record.");
    const record = undoVoiceChanges(store.context, receipt);
    await store.save(record);
    await store.addEvent({ id: receipt.undoId, actorId: actor.id, action: "voice.undone", entityId: receiptId, detail });
  }, (snapshot) => {
    if (localEvent(actor, receipt.undoId)) return;
    checkExpiry(receipt.expiresAt, "The 15-minute Undo window has ended. You can still edit the record.");
    const record = undoVoiceChanges(voiceContextFromSnapshot(snapshot, receipt.target), receipt);
    saveLocal(snapshot, actor, record); addLocal(actor, receipt.undoId, "voice.undone", receiptId, detail);
  });
}

export async function recoverVoicePlan(actor: CurrentMember, planId: string) {
  const plan = readPlan(await readOwnedEvent(actor, planId), actor);
  const applied = await readOwnedEvent(actor, plan.receiptId);
  if (applied) {
    const receipt = assertReceiptEvent(applied, actor);
    return (await readOwnedEvent(actor, receipt.undoId)) ? { status: "undone" as const } : { status: "applied" as const, receipt };
  }
  if (Date.now() > Date.parse(plan.expiresAt)) return { status: "expired" as const };
  return { status: "review" as const, plan };
}
