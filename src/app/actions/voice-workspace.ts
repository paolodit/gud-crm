"use server";

import { and, count, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, organisations } from "@/db/schema";
import { publicActionError } from "@/lib/action-error";
import { interpretWorkspaceVoice } from "@/lib/ai/voice-workspace";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { consumeLocalAiRateLimit, getLocalAiEnabled } from "@/lib/data/local-store";
import { applyVoicePlan, prepareVoicePlan, recoverVoicePlan, undoVoicePlan, voiceContextFromSnapshot } from "@/lib/data/voice-workspace-repository";
import { liveProjectRecords } from "@/lib/domain/delivery";
import { voiceChangesSchema, voiceTargetSchema, voiceTimezoneSchema, type VoiceChoice } from "@/lib/domain/voice-workspace";
import { env } from "@/lib/env";
import { getCurrentMember, type CurrentMember } from "@/lib/session";

async function member() {
  const current = await getCurrentMember();
  if (!current) throw new Error("You must be signed in.");
  if (current.storageMode === "demo") throw new Error("Use a saved workspace for voice updates.");
  return current;
}
async function enabled(actor: CurrentMember) {
  if (!env.aiEnabled || env.AI_PROVIDER !== "openai" || !env.OPENAI_API_KEY) return false;
  if (actor.storageMode === "sqlite") return getLocalAiEnabled();
  const [org] = await db.select({ enabled: organisations.aiEnabled }).from(organisations).where(eq(organisations.id, actor.organisationId)).limit(1);
  return Boolean(org?.enabled);
}
async function reserveVoiceRequest(actor: CurrentMember) {
  const windowMs = 15 * 60_000;
  if (actor.storageMode === "sqlite") return consumeLocalAiRateLimit(`${actor.organisationId}:${actor.id}`, env.AI_RATE_LIMIT, windowMs);
  return db.transaction(async (tx) => {
    await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, actor.organisationId)).for("update");
    const [row] = await tx.select({ value: count() }).from(auditEvents).where(and(eq(auditEvents.organisationId, actor.organisationId), eq(auditEvents.actorId, actor.id), eq(auditEvents.action, "voice.requested"), gte(auditEvents.createdAt, new Date(Date.now() - windowMs))));
    if (Number(row?.value ?? 0) >= env.AI_RATE_LIMIT) return false;
    await tx.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action: "voice.requested", entityType: "voice_update", entityId: crypto.randomUUID(), after: { model: env.AI_MODEL } });
    return true;
  });
}
function refreshWorkspace() {
  for (const path of ["/pipeline", "/live", "/my-work", "/reports", "/targets", "/companies", "/search"]) revalidatePath(path);
}

export async function loadVoiceWorkspaceAction() {
  try {
    const actor = await member();
    const snapshot = await getBoardSnapshot(actor.organisationId, { includeHistory: false });
    const choices: VoiceChoice[] = [
      ...snapshot.opportunities.filter((item) => !item.archivedAt && !item.company.archivedAt).map((item): VoiceChoice => ({ target: { kind: "sales", id: item.id }, companyName: item.company.name, title: item.title })),
      ...liveProjectRecords(snapshot).filter((item) => !item.delivery.archivedAt).map((item): VoiceChoice => ({ target: { kind: item.source === "direct" ? "direct" : "delivery", id: item.id }, companyName: item.companyName, title: item.title })),
    ];
    return { ok: true as const, choices, aiConfigured: await enabled(actor) };
  } catch (error) { return { ok: false as const, error: publicActionError(error, "Voice capture is unavailable right now.") }; }
}

export async function prepareWorkspaceVoiceAction(input: unknown) {
  const parsed = z.object({ target: voiceTargetSchema, transcript: z.string().trim().min(2).max(12000), timezone: voiceTimezoneSchema }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Choose a record and add a short update." };
  try {
    const actor = await member();
    if (!(await enabled(actor))) throw new Error("Voice review needs OpenAI enabled in Settings → AI connections.");
    const snapshot = await getBoardSnapshot(actor.organisationId, { opportunityIds: parsed.data.target.kind === "direct" ? [] : [parsed.data.target.id], includeHistory: false });
    const context = voiceContextFromSnapshot(snapshot, parsed.data.target);
    if (!(await reserveVoiceRequest(actor))) throw new Error("Voice review is at its short-term limit. Try again in about 15 minutes.");
    const result = await interpretWorkspaceVoice(parsed.data.transcript, context, parsed.data.timezone);
    if (result.clarification) return { ok: false as const, error: result.clarification };
    const plan = await prepareVoicePlan(actor, parsed.data.target, result.changes, result.taskDateHint);
    return { ok: true as const, plan, references: { salesStages: context.salesStages, deliveryStages: context.deliveryStages, activityTypes: context.activityTypes } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error && /abort|timeout/i.test(error.message) ? "Preparing took too long. Nothing was applied; your words are still here." : publicActionError(error, "Could not prepare that update. Your words are still here.") };
  }
}

export async function applyWorkspaceVoiceAction(input: unknown) {
  const parsed = z.object({ planId: z.uuid(), changes: voiceChangesSchema }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the reviewed changes and try again." };
  try {
    const actor = await member();
    const receipt = await applyVoicePlan(actor, parsed.data.planId, parsed.data.changes);
    refreshWorkspace();
    return { ok: true as const, receipt };
  } catch (error) { return { ok: false as const, error: publicActionError(error, "Nothing was applied. Check the record and try again.") }; }
}

export async function undoWorkspaceVoiceAction(input: unknown) {
  const parsed = z.object({ receiptId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Choose a valid voice update." };
  try {
    const actor = await member();
    await undoVoicePlan(actor, parsed.data.receiptId);
    refreshWorkspace();
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: publicActionError(error, "Undo could not be completed. No changes were made.") }; }
}

export async function recoverWorkspaceVoiceAction(input: unknown) {
  const parsed = z.object({ planId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "The earlier review could not be identified." };
  try {
    const actor = await member();
    const result = await recoverVoicePlan(actor, parsed.data.planId);
    if (result.status !== "review") return { ok: true as const, ...result };
    const snapshot = await getBoardSnapshot(actor.organisationId, { opportunityIds: result.plan.target.kind === "direct" ? [] : [result.plan.target.id], includeHistory: false });
    const context = voiceContextFromSnapshot(snapshot, result.plan.target);
    return { ok: true as const, status: "review" as const, review: { ok: true as const, plan: result.plan, references: { salesStages: context.salesStages, deliveryStages: context.deliveryStages, activityTypes: context.activityTypes } } };
  } catch (error) { return { ok: false as const, error: publicActionError(error, "Could not check the earlier save. Try again before preparing another update.") }; }
}
