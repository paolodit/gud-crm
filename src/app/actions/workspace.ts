"use server";

import { and, asc, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, offers, opportunities, organisations, pipelines, sessions, stages, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { publicActionError } from "@/lib/action-error";
import { getLocalBoardSnapshot, getLocalSetting, recordLocalAuditEvent, setLocalSetting, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import { salesAssetDefaults } from "@/lib/data/workspace-repository";
import { normaliseName } from "@/lib/domain/normalise";
import type { OfferSummary, PersonSummary, SalesAssetSummary } from "@/lib/domain/types";
import { getCurrentMember } from "@/lib/session";
import { isSafeHttpUrl } from "@/lib/domain/normalise";
import { saveFreeMaxRuntimeConfiguration } from "@/lib/enrichment/config";

type Result = { ok: true } | { ok: false; error: string };
type TeamResult = { ok: true; member: PersonSummary } | { ok: false; error: string };
type OfferResult = { ok: true; offer: OfferSummary } | { ok: false; error: string };

const optionalUrl = z.string().trim().max(2_000).refine((value) => !value || isSafeHttpUrl(value), "Enter a complete HTTP or HTTPS URL.");
const savePipelineSchema = z.object({ name: z.string().trim().min(2).max(160) });
const saveEditionSchema = z.object({ edition: z.enum(["focused", "service"]) });
const saveAssetSchema = z.object({
  offerId: z.uuid(),
  id: z.enum(["website", "walkthrough", "playable_demo", "benefits_pdf", "qualifier", "compliance_research"]),
  status: z.enum(["ready", "in_progress", "missing", "untracked"]),
  url: optionalUrl.default(""),
  note: z.string().trim().max(1_000).default(""),
});
const saveTeamSchema = z.object({
  userId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(2).max(160),
  email: z.email(),
  role: z.enum(["admin", "manager", "member"]),
  temporaryPassword: z.string().min(12).max(128).or(z.literal("")).default(""),
});
const deactivateTeamSchema = z.object({ userId: z.string().trim().min(1) });
const saveOfferSchema = z.object({
  offerId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(160),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i, "Choose a valid colour."),
  description: z.string().trim().max(2_000).default(""),
  idealCustomer: z.string().trim().max(2_000).default(""),
  positioning: z.string().trim().max(2_000).default(""),
  isDefault: z.boolean().default(false),
});
const deactivateOfferSchema = z.object({ offerId: z.uuid() });
const saveFreeMaxSchema = z.object({
  hunterKey: z.string().trim().max(1_000).default(""),
  norbertKey: z.string().trim().max(1_000).default(""),
  disconnectHunter: z.boolean().default(false),
  disconnectNorbert: z.boolean().default(false),
  primary: z.enum(["hunter", "norbert"]).default("hunter"),
});

async function requireAdmin() {
  const member = await getCurrentMember();
  if (!member) throw new Error("You must be signed in.");
  if (member.role !== "admin") throw new Error("Only workspace admins can manage this setting.");
  return member;
}

export async function savePipelineNameAction(input: unknown): Promise<Result> {
  const parsed = savePipelineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the pipeline name." };
  try {
    const member = await requireAdmin();
    if (member.demoMode) return { ok: false, error: "Settings reset in demo mode." };
    if (member.storageMode === "sqlite") {
      updateLocalBoardSnapshot((snapshot) => { snapshot.pipeline.name = parsed.data.name; });
      recordLocalAuditEvent({ actorId: member.id, action: "pipeline.renamed", entityType: "pipeline", entityId: "default", detail: { name: parsed.data.name } });
    } else {
      const [pipeline] = await db.update(pipelines).set({ name: parsed.data.name, updatedAt: new Date() }).where(and(eq(pipelines.organisationId, member.organisationId), eq(pipelines.active, true))).returning({ id: pipelines.id });
      if (!pipeline) throw new Error("No active pipeline is configured.");
      await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "pipeline.renamed", entityType: "pipeline", entityId: pipeline.id, after: { name: parsed.data.name } });
    }
    revalidatePath("/pipeline");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Pipeline name could not be saved.") };
  }
}

export async function saveWorkspaceEditionAction(input: unknown): Promise<Result> {
  const parsed = saveEditionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a supported sales model." };
  try {
    const member = await requireAdmin();
    if (member.demoMode) return { ok: false, error: "Sales-model changes reset in demo mode." };
    if (member.storageMode === "sqlite") {
      updateLocalBoardSnapshot((snapshot) => { snapshot.edition = parsed.data.edition; });
      recordLocalAuditEvent({ actorId: member.id, action: "workspace.edition_changed", entityType: "workspace", entityId: "default", detail: { edition: parsed.data.edition } });
    } else {
      const [row] = await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, member.organisationId)).limit(1);
      if (!row) throw new Error("Workspace not found.");
      await db.update(organisations).set({ settings: { ...row.settings, edition: parsed.data.edition }, updatedAt: new Date() }).where(eq(organisations.id, member.organisationId));
      await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "workspace.edition_changed", entityType: "workspace", entityId: member.organisationId, after: { edition: parsed.data.edition } });
    }
    for (const path of ["/settings", "/my-work", "/pipeline", "/research", "/companies", "/reports", "/playbook"]) revalidatePath(path);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Workspace sales model could not be saved.") };
  }
}

export async function saveFreeMaxConfigurationAction(input: unknown): Promise<Result> {
  const parsed = saveFreeMaxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the provider settings." };
  try {
    const member = await requireAdmin();
    if (member.demoMode) return { ok: false, error: "Provider settings reset in demo mode." };
    await saveFreeMaxRuntimeConfiguration(member.organisationId, member.storageMode, parsed.data);
    if (member.storageMode === "sqlite") {
      recordLocalAuditEvent({
        actorId: member.id,
        action: "freemax.configuration_updated",
        entityType: "workspace",
        entityId: member.organisationId,
        detail: { primary: parsed.data.primary, hunterConnected: !parsed.data.disconnectHunter, norbertConnected: !parsed.data.disconnectNorbert },
      });
    } else {
      await db.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "freemax.configuration_updated",
        entityType: "workspace",
        entityId: member.organisationId,
        after: { primary: parsed.data.primary, hunterDisconnected: parsed.data.disconnectHunter, norbertDisconnected: parsed.data.disconnectNorbert },
      });
    }
    revalidatePath("/settings");
    revalidatePath("/research");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "FreeMax configuration could not be saved.") };
  }
}

export async function saveOfferAction(input: unknown): Promise<OfferResult> {
  const parsed = saveOfferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the offer details." };
  try {
    const member = await requireAdmin();
    if (member.demoMode) return { ok: false, error: "Offers reset in demo mode." };
    const data = parsed.data;
    let saved: OfferSummary;
    if (member.storageMode === "sqlite") {
      saved = updateLocalBoardSnapshot((snapshot) => {
        const duplicate = snapshot.offers.find((offer) => offer.id !== data.offerId && normaliseName(offer.name) === normaliseName(data.name));
        if (duplicate) throw new Error("An offer with that name already exists.");
        const existing = data.offerId ? snapshot.offers.find((offer) => offer.id === data.offerId) : null;
        if (data.offerId && !existing) throw new Error("That offer is not available.");
        const isDefault = data.isDefault || existing?.isDefault === true || !snapshot.offers.some((offer) => offer.active && offer.isDefault);
        const next: OfferSummary = {
          id: existing?.id ?? crypto.randomUUID(),
          name: data.name,
          colour: data.colour.toUpperCase(),
          description: data.description,
          idealCustomer: data.idealCustomer,
          positioning: data.positioning,
          isDefault,
          active: existing?.active ?? true,
          position: existing?.position ?? Math.max(-1, ...snapshot.offers.map((offer) => offer.position)) + 1,
        };
        snapshot.offers = snapshot.offers.map((offer) => ({
          ...(offer.id === next.id ? next : offer),
          isDefault: offer.id === next.id ? next.isDefault : next.isDefault ? false : offer.isDefault,
        }));
        if (!existing) snapshot.offers.push(next);
        for (const opportunity of snapshot.opportunities) if (opportunity.offer?.id === next.id) opportunity.offer = { ...next };
        return next;
      });
      recordLocalAuditEvent({ actorId: member.id, action: data.offerId ? "offer.updated" : "offer.created", entityType: "offer", entityId: saved.id, detail: { name: saved.name, isDefault: saved.isDefault } });
    } else {
      saved = await db.transaction(async (tx) => {
        const rows = await tx.select().from(offers).where(eq(offers.organisationId, member.organisationId)).orderBy(asc(offers.position));
        const duplicate = rows.find((offer) => offer.id !== data.offerId && offer.normalisedName === normaliseName(data.name));
        if (duplicate) throw new Error("An offer with that name already exists.");
        const existing = data.offerId ? rows.find((offer) => offer.id === data.offerId) : null;
        if (data.offerId && !existing) throw new Error("That offer is not available.");
        const isDefault = data.isDefault || existing?.isDefault === true || !rows.some((offer) => offer.active && offer.isDefault);
        if (isDefault) await tx.update(offers).set({ isDefault: false, updatedAt: new Date() }).where(eq(offers.organisationId, member.organisationId));
        const values = {
          name: data.name,
          normalisedName: normaliseName(data.name),
          colour: data.colour.toUpperCase(),
          description: data.description,
          idealCustomer: data.idealCustomer,
          positioning: data.positioning,
          isDefault,
          updatedAt: new Date(),
        };
        const [row] = existing
          ? await tx.update(offers).set(values).where(and(eq(offers.id, existing.id), eq(offers.organisationId, member.organisationId))).returning()
          : await tx.insert(offers).values({ ...values, organisationId: member.organisationId, active: true, position: rows.length }).returning();
        await tx.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: existing ? "offer.updated" : "offer.created", entityType: "offer", entityId: row.id, after: { name: row.name, isDefault: row.isDefault } });
        return {
          id: row.id, name: row.name, colour: row.colour, description: row.description,
          idealCustomer: row.idealCustomer, positioning: row.positioning, isDefault: row.isDefault,
          active: row.active, position: row.position,
        };
      });
    }
    revalidateOfferPaths();
    return { ok: true, offer: saved };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Offer could not be saved.") };
  }
}

export async function deactivateOfferAction(input: unknown): Promise<Result> {
  const parsed = deactivateOfferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That offer is invalid." };
  try {
    const member = await requireAdmin();
    if (member.demoMode) return { ok: false, error: "Offers reset in demo mode." };
    if (member.storageMode === "sqlite") {
      updateLocalBoardSnapshot((snapshot) => {
        const offer = snapshot.offers.find((item) => item.id === parsed.data.offerId);
        if (!offer) throw new Error("That offer is not available.");
        if (offer.isDefault) throw new Error("Choose another default offer before archiving this one.");
        if (snapshot.offers.filter((item) => item.active).length <= 1) throw new Error("A workspace must keep at least one active offer.");
        const hasOpenWork = snapshot.opportunities.some((opportunity) => opportunity.offer?.id === offer.id && snapshot.stages.find((stage) => stage.id === opportunity.stageId)?.terminalType === "open");
        if (hasOpenWork) throw new Error("Close, reassign or move this offer's open opportunities before archiving it.");
        offer.active = false;
        for (const opportunity of snapshot.opportunities) if (opportunity.offer?.id === offer.id) opportunity.offer = { ...offer };
      });
      recordLocalAuditEvent({ actorId: member.id, action: "offer.archived", entityType: "offer", entityId: parsed.data.offerId });
    } else {
      await db.transaction(async (tx) => {
        const rows = await tx.select().from(offers).where(and(eq(offers.organisationId, member.organisationId), eq(offers.active, true)));
        const offer = rows.find((item) => item.id === parsed.data.offerId);
        if (!offer) throw new Error("That offer is not available.");
        if (offer.isDefault) throw new Error("Choose another default offer before archiving this one.");
        if (rows.length <= 1) throw new Error("A workspace must keep at least one active offer.");
        const [openWork] = await tx.select({ id: opportunities.id }).from(opportunities)
          .innerJoin(stages, eq(opportunities.stageId, stages.id))
          .where(and(eq(opportunities.organisationId, member.organisationId), eq(opportunities.offerId, offer.id), eq(stages.terminalType, "open")))
          .limit(1);
        if (openWork) throw new Error("Close, reassign or move this offer's open opportunities before archiving it.");
        await tx.update(offers).set({ active: false, updatedAt: new Date() }).where(and(eq(offers.id, offer.id), ne(offers.isDefault, true)));
        await tx.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "offer.archived", entityType: "offer", entityId: offer.id });
      });
    }
    revalidateOfferPaths();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Offer could not be archived.") };
  }
}

function revalidateOfferPaths() {
  for (const path of ["/settings", "/pipeline", "/research", "/companies", "/search", "/reports", "/my-work", "/playbook"]) revalidatePath(path);
}

export async function saveSalesAssetAction(input: unknown): Promise<Result> {
  const parsed = saveAssetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the asset details." };
  try {
    const member = await getCurrentMember();
    if (!member) throw new Error("You must be signed in.");
    if (!(["admin", "manager"] as const).includes(member.role as "admin" | "manager")) throw new Error("Only admins and managers can update the sales asset kit.");
    if (member.demoMode) return { ok: false, error: "Assets reset in demo mode." };
    if (member.storageMode === "sqlite") {
      const snapshot = getLocalBoardSnapshot();
      const offer = snapshot.offers.find((item) => item.id === parsed.data.offerId && item.active);
      if (!offer) throw new Error("That offer is not available.");
      const byOffer = getLocalSetting<Record<string, SalesAssetSummary[]>>("sales_assets_by_offer") ?? {};
      const legacy = offer.isDefault ? getLocalSetting<SalesAssetSummary[]>("sales_assets") : null;
      const current = byOffer[offer.id] ?? legacy ?? salesAssetDefaults;
      const asset = { id: parsed.data.id, status: parsed.data.status, url: parsed.data.url, note: parsed.data.note } satisfies SalesAssetSummary;
      setLocalSetting("sales_assets_by_offer", { ...byOffer, [offer.id]: current.map((item) => item.id === asset.id ? asset : item) });
      recordLocalAuditEvent({ actorId: member.id, action: "sales_asset.updated", entityType: "sales_asset", entityId: parsed.data.id, detail: parsed.data });
    } else {
      const [offer] = await db.select({ id: offers.id, isDefault: offers.isDefault }).from(offers).where(and(eq(offers.id, parsed.data.offerId), eq(offers.organisationId, member.organisationId), eq(offers.active, true))).limit(1);
      if (!offer) throw new Error("That offer is not available.");
      const [row] = await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, member.organisationId)).limit(1);
      const settings = row?.settings ?? {};
      const byOffer = settings.salesAssetsByOffer && typeof settings.salesAssetsByOffer === "object" && !Array.isArray(settings.salesAssetsByOffer) ? settings.salesAssetsByOffer as Record<string, SalesAssetSummary[]> : {};
      const legacy = offer.isDefault && Array.isArray(settings.salesAssets) ? settings.salesAssets as SalesAssetSummary[] : null;
      const stored = byOffer[offer.id] ?? legacy ?? salesAssetDefaults;
      const asset = { id: parsed.data.id, status: parsed.data.status, url: parsed.data.url, note: parsed.data.note } satisfies SalesAssetSummary;
      const salesAssets = stored.map((item) => item.id === asset.id ? asset : item);
      await db.update(organisations).set({ settings: { ...settings, salesAssetsByOffer: { ...byOffer, [offer.id]: salesAssets } }, updatedAt: new Date() }).where(eq(organisations.id, member.organisationId));
      await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "sales_asset.updated", entityType: "sales_asset", entityId: parsed.data.id, after: parsed.data });
    }
    revalidatePath("/playbook");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Asset could not be saved.") };
  }
}

export async function saveTeamMemberAction(input: unknown): Promise<TeamResult> {
  const parsed = saveTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the team member." };
  try {
    const adminMember = await requireAdmin();
    if (adminMember.demoMode) return { ok: false, error: "Team changes reset in demo mode." };
    const data = parsed.data;
    if (!data.userId && !data.temporaryPassword && adminMember.storageMode === "postgres") return { ok: false, error: "Set a temporary password of at least 12 characters." };
    if (data.userId === adminMember.id && data.role !== "admin") return { ok: false, error: "You cannot remove your own admin access." };

    let saved: PersonSummary;
    if (adminMember.storageMode === "sqlite") {
      saved = updateLocalBoardSnapshot((snapshot) => {
        const duplicate = snapshot.users.find((user) => user.id !== data.userId && user.email?.toLowerCase() === data.email.toLowerCase());
        if (duplicate) throw new Error("That email is already in the team roster.");
        const next: PersonSummary = { id: data.userId ?? crypto.randomUUID(), name: data.name, email: data.email.toLowerCase(), role: data.role, active: true };
        snapshot.users = data.userId ? snapshot.users.map((user) => user.id === data.userId ? next : user) : [...snapshot.users, next];
        for (const opportunity of snapshot.opportunities) if (opportunity.owner?.id === next.id) opportunity.owner = next;
        return next;
      });
      recordLocalAuditEvent({ actorId: adminMember.id, action: data.userId ? "team_member.updated" : "team_member.created", entityType: "user", entityId: saved.id, detail: { name: saved.name, email: saved.email, role: saved.role, localRosterOnly: true } });
    } else if (data.userId) {
      const [row] = await db.update(users).set({ name: data.name, email: data.email.toLowerCase(), role: data.role, active: true, updatedAt: new Date() }).where(and(eq(users.id, data.userId), eq(users.organisationId, adminMember.organisationId))).returning();
      if (!row) throw new Error("That team member is not available.");
      if (data.temporaryPassword) await auth.api.setUserPassword({ body: { userId: row.id, newPassword: data.temporaryPassword }, headers: await headers() });
      saved = { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
    } else {
      const result = await auth.api.createUser({ body: { email: data.email.toLowerCase(), password: data.temporaryPassword, name: data.name, role: data.role === "admin" ? "admin" : undefined, data: { organisationId: adminMember.organisationId, active: true } } });
      await db.update(users).set({ organisationId: adminMember.organisationId, role: data.role, active: true, updatedAt: new Date() }).where(eq(users.id, result.user.id));
      saved = { id: result.user.id, name: result.user.name, email: result.user.email, role: data.role, active: true };
    }
    revalidatePath("/settings");
    return { ok: true, member: saved };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Team member could not be saved.") };
  }
}

export async function deactivateTeamMemberAction(input: unknown): Promise<Result> {
  const parsed = deactivateTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That team member is invalid." };
  try {
    const member = await requireAdmin();
    if (parsed.data.userId === member.id) return { ok: false, error: "You cannot deactivate your own account." };
    if (member.demoMode) return { ok: false, error: "Team changes reset in demo mode." };
    if (member.storageMode === "sqlite") {
      updateLocalBoardSnapshot((snapshot) => { snapshot.users = snapshot.users.filter((user) => user.id !== parsed.data.userId); });
      recordLocalAuditEvent({ actorId: member.id, action: "team_member.deactivated", entityType: "user", entityId: parsed.data.userId, detail: { localRosterOnly: true } });
    } else {
      await db.transaction(async (tx) => {
        const [user] = await tx.update(users).set({ active: false, updatedAt: new Date() }).where(and(eq(users.id, parsed.data.userId), eq(users.organisationId, member.organisationId))).returning({ id: users.id });
        if (!user) throw new Error("That team member is not available.");
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "team_member.deactivated", entityType: "user", entityId: user.id });
      });
    }
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Team member could not be deactivated.") };
  }
}
