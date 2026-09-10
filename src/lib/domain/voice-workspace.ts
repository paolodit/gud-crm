import { z } from "zod";
import { deliveryDetails, projectValueSchema, type DeliveryDetails, type DeliveryStage } from "./delivery";
import type { ActivityTypeSummary, Priority, StageSummary, Temperature } from "./types";

export const voiceTargetSchema = z.object({ kind: z.enum(["sales", "delivery", "direct"]), id: z.uuid() }).strict();
export type VoiceTarget = z.infer<typeof voiceTargetSchema>;
export const voiceTimezoneSchema = z.string().max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid timezone.");
const instant = z.iso.datetime({ offset: true });
const money = z.number().min(0).max(9_999_999_999.99).multipleOf(0.01);
const priority = z.enum(["low", "medium", "high", "critical"]);
const temperature = z.enum(["cold", "warm", "hot", "at_risk", "unresponsive"]);

export const voiceChangesSchema = z.object({
  salesStage: z.uuid().optional(), salesValue: money.nullable().optional(),
  priority: priority.optional(), temperature: temperature.optional(),
  deliveryStage: z.string().min(1).max(80).optional(), deliveryValue: projectValueSchema.nullable().optional(),
  milestone: z.string().trim().min(1).max(240).optional(), milestoneDate: z.iso.date().nullable().optional(),
  deliveryNote: z.string().trim().min(1).max(5000).optional(),
  activity: z.object({ typeId: z.uuid(), notes: z.string().trim().min(2).max(5000), outcome: z.string().trim().max(200).nullable(), occurredAt: instant }).strict().optional(),
  task: z.object({ title: z.string().trim().min(2).max(240), dueAt: instant.nullable() }).strict().optional(),
}).strict();
export type VoiceChanges = z.infer<typeof voiceChangesSchema>;
export type VoiceFieldKey = Exclude<keyof VoiceChanges, "activity" | "task">;
export const voiceFieldKeys: VoiceFieldKey[] = ["salesStage", "salesValue", "priority", "temperature", "deliveryStage", "deliveryValue", "milestone", "milestoneDate", "deliveryNote"];
export const voiceLabels: Record<VoiceFieldKey, string> = {
  salesStage: "Sales stage", salesValue: "Sales estimate (£)", priority: "Priority", temperature: "Temperature",
  deliveryStage: "Delivery stage", deliveryValue: "Project value (£)", milestone: "Next milestone", milestoneDate: "Milestone due", deliveryNote: "Append delivery note",
};
export type VoiceFields = {
  salesStage: string; salesValue: number | null; priority: Priority; temperature: Temperature;
  deliveryStage: string; deliveryValue: number | null; milestone: string; milestoneDate: string | null; deliveryNote: string;
};
export type VoiceActivity = { id: string; typeId: string; notes: string | null; outcome: string | null; occurredAt: string; contactId: string | null; createdById: string | null; createdAt: string };
export type VoiceTask = { id: string; title: string; dueAt: string; status: "open" | "completed" | "cancelled"; ownerId: string | null; contactId: string | null };
export type VoiceRecord = {
  target: VoiceTarget; companyName: string; title: string; companyId: string | null; ownerId: string | null; offerId: string | null;
  fields: VoiceFields; delivery: DeliveryDetails; activities: VoiceActivity[]; tasks: VoiceTask[];
  noNextActionReason: string | null;
};
export type VoiceContext = { record: VoiceRecord; salesStages: StageSummary[]; deliveryStages: DeliveryStage[]; activityTypes: ActivityTypeSummary[] };
export type VoiceChoice = { target: VoiceTarget; companyName: string; title: string };
export type VoicePlan = {
  id: string; receiptId: string; undoId: string; target: VoiceTarget; companyName: string; title: string;
  before: VoiceFields; changes: VoiceChanges; createdAt: string; expiresAt: string; taskDateHint: string | null;
};
export type VoiceReceipt = {
  id: string; planId: string; undoId: string; target: VoiceTarget; companyName: string; title: string;
  changes: VoiceChanges; before: VoiceFields; after: VoiceFields; previousReason: string | null;
  activity: VoiceActivity | null; task: VoiceTask | null; createdAt: string; expiresAt: string;
};

export function voiceFields(input: { stageId?: string; expectedValue?: number | null; priority?: Priority; temperature?: Temperature; delivery?: unknown }): VoiceFields {
  const delivery = deliveryDetails(input.delivery);
  return { salesStage: input.stageId ?? "", salesValue: input.expectedValue ?? null, priority: input.priority ?? "medium", temperature: input.temperature ?? "cold", deliveryStage: delivery.stage, deliveryValue: delivery.projectValue ?? null, milestone: delivery.nextMilestone, milestoneDate: delivery.dueDate, deliveryNote: delivery.notes };
}

export function assertVoiceChanges(context: VoiceContext, changes: VoiceChanges, applying = false) {
  voiceChangesSchema.parse(changes);
  if (!Object.keys(changes).length) throw new Error("Choose at least one change to apply.");
  const { record } = context;
  if (record.target.kind !== "sales" && ["salesStage", "salesValue", "priority", "temperature"].some((key) => key in changes)) throw new Error("Delivery updates cannot change sales figures or stages.");
  if (record.target.kind === "sales" && ["deliveryStage", "deliveryValue", "milestone", "milestoneDate", "deliveryNote"].some((key) => key in changes)) throw new Error("Choose the live project to change delivery details.");
  if (record.target.kind === "direct" && (changes.activity || changes.task)) throw new Error("For a direct project, use delivery notes and its next milestone.");
  if (changes.salesStage) {
    const stage = context.salesStages.find((item) => item.id === changes.salesStage);
    if (!stage) throw new Error("The sales stage is no longer available. Prepare the update again.");
    if (!record.offerId && !["Researching", "Research holding"].includes(stage.name)) throw new Error("Choose an offer on this record before moving it onto the pipeline.");
  }
  if (changes.deliveryStage && !context.deliveryStages.some((item) => item.id === changes.deliveryStage)) throw new Error("The delivery stage is no longer available. Prepare the update again.");
  if (changes.deliveryNote && [record.fields.deliveryNote, changes.deliveryNote].filter(Boolean).join("\n\n").length > 10000) throw new Error("The delivery notes are full. Shorten this note or edit the project first.");
  if (changes.activity && !context.activityTypes.some((item) => item.id === changes.activity?.typeId)) throw new Error("Choose an available activity type.");
  if (changes.activity && Date.parse(changes.activity.occurredAt) > Date.now() + 5 * 60_000) throw new Error("An activity must already have happened. Use a next action for future work.");
  if (applying && changes.task && !changes.task.dueAt) throw new Error("Choose a date and time for the next action.");
}

export function assertPlanUnchanged(context: VoiceContext, plan: VoicePlan, changes: VoiceChanges) {
  for (const key of Object.keys(changes) as Array<keyof VoiceChanges>) {
    if (!(key in plan.changes)) throw new Error("Prepare a new review to add another kind of change.");
    if (key !== "activity" && key !== "task" && context.record.fields[key] !== plan.before[key]) throw new Error(`${voiceLabels[key]} changed since this review. Prepare it again so no work is overwritten.`);
  }
}

export function applyVoiceChanges(context: VoiceContext, plan: VoicePlan, changes: VoiceChanges, actor: { id: string }, now: Date) {
  assertVoiceChanges(context, changes, true);
  assertPlanUnchanged(context, plan, changes);
  const record = structuredClone(context.record);
  const before = { ...record.fields };
  const fields = { ...record.fields };
  for (const key of voiceFieldKeys) {
    if (!(key in changes)) continue;
    if (key === "deliveryNote") fields.deliveryNote = [fields.deliveryNote, changes.deliveryNote].filter(Boolean).join("\n\n");
    else Object.assign(fields, { [key]: changes[key] });
  }
  record.fields = fields;
  let activity: VoiceActivity | null = null;
  let task: VoiceTask | null = null;
  if (changes.activity) {
    activity = { ...changes.activity, id: crypto.randomUUID(), contactId: null, createdById: actor.id, createdAt: now.toISOString(), occurredAt: new Date(changes.activity.occurredAt).toISOString() };
    record.activities.push(activity);
  }
  if (changes.task?.dueAt) {
    task = { id: crypto.randomUUID(), title: changes.task.title, dueAt: new Date(changes.task.dueAt).toISOString(), status: "open", ownerId: record.ownerId ?? actor.id, contactId: null };
    record.tasks.push(task); record.noNextActionReason = null;
  }
  const receipt: VoiceReceipt = { id: plan.receiptId, planId: plan.id, undoId: plan.undoId, target: plan.target, companyName: plan.companyName, title: plan.title, changes, before, after: fields, previousReason: context.record.noNextActionReason, activity, task, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
  return { record, receipt: structuredClone(receipt) };
}

const same = (a: object | undefined, b: object) => Boolean(a) && Object.keys(b).every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
export function undoVoiceChanges(context: VoiceContext, receipt: VoiceReceipt) {
  const record = structuredClone(context.record);
  if (receipt.changes.salesStage && (["deliveryStage", "deliveryValue", "milestone", "milestoneDate", "deliveryNote"] as const).some((key) => record.fields[key] !== receipt.after[key])) throw new Error("Delivery work has changed since this stage move. Undo is no longer safe.");
  for (const key of voiceFieldKeys) {
    if (!(key in receipt.changes)) continue;
    if (record.fields[key] !== receipt.after[key]) throw new Error("This record has changed since your update. Undo would overwrite newer work; edit the record instead.");
    Object.assign(record.fields, { [key]: receipt.before[key] });
  }
  if (receipt.activity) {
    const current = record.activities.find((item) => item.id === receipt.activity!.id);
    if (!same(current, receipt.activity)) throw new Error("The logged activity has changed. Undo is no longer safe.");
    record.activities = record.activities.filter((item) => item.id !== receipt.activity!.id);
  }
  if (receipt.task) {
    const current = record.tasks.find((item) => item.id === receipt.task!.id);
    if (!same(current, receipt.task)) throw new Error("The next action has changed or been completed. Undo is no longer safe.");
    record.tasks = record.tasks.filter((item) => item.id !== receipt.task!.id);
    if (!record.tasks.some((item) => item.status === "open") && record.noNextActionReason === null) record.noNextActionReason = receipt.previousReason;
  }
  if (receipt.changes.salesStage && !context.salesStages.some((item) => item.id === record.fields.salesStage)) throw new Error("The original sales stage is no longer available.");
  if (receipt.changes.deliveryStage && !context.deliveryStages.some((item) => item.id === record.fields.deliveryStage)) throw new Error("The original delivery stage is no longer available.");
  return record;
}

export function deliveryFromVoiceRecord(record: VoiceRecord) {
  return { ...record.delivery, stage: record.fields.deliveryStage, projectValue: record.fields.deliveryValue, nextMilestone: record.fields.milestone, dueDate: record.fields.milestoneDate, notes: record.fields.deliveryNote };
}

export function voiceRecordHref(target: VoiceTarget) {
  return target.kind === "sales" ? `/pipeline?opportunity=${target.id}` : `/live?project=${target.id}`;
}

/** Interpret a wall-clock time in the user's IANA zone; reject DST gaps and ambiguous hours. */
export function voiceLocalToIso(local: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const raw = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(raw)) return null;
  const candidates = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const sample = raw + delta * 3600_000;
    const displayed = Date.parse(`${voiceIsoToLocal(new Date(sample).toISOString(), timezone)}:00Z`);
    const candidate = raw - (displayed - sample);
    if (voiceIsoToLocal(new Date(candidate).toISOString(), timezone) === local) candidates.add(candidate);
  }
  return candidates.size === 1 ? new Date([...candidates][0]).toISOString() : null;
}

export function voiceIsoToLocal(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
