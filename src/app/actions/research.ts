"use server";

import { and, eq, isNull, max, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { publicActionError } from "@/lib/action-error";
import {
  auditEvents,
  companies,
  contacts,
  opportunities,
  opportunityContacts,
  offers,
  pipelines,
  researchThemes,
  stages,
} from "@/db/schema";
import { getLocalBoardSnapshot, recordLocalAuditEvent, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import { findWorkEmailFreeMax, providerLabel } from "@/lib/enrichment/freemax";
import { getFreeMaxStatus, recordLocalFreeMaxSuccess } from "@/lib/enrichment/usage";
import { getFreeMaxRuntimeConfiguration } from "@/lib/enrichment/config";
import { extractDomain, isSafeHttpUrl, normaliseName } from "@/lib/domain/normalise";
import type { CompanySummary, ContactSummary, OfferSummary, ResearchThemeSummary } from "@/lib/domain/types";
import {
  reconcileResearchContacts,
  type ResearchContactAssociation,
  type ResearchContactImportMode,
  type ResearchContactRecord,
} from "@/lib/import/research-contacts";
import { parseResearchImport, type ResearchTargetInput } from "@/lib/import/research-import";
import { getCurrentMember } from "@/lib/session";

const httpUrl = z.url().refine(isSafeHttpUrl, "Only HTTP and HTTPS source links are allowed.");

type ResearchImportResult =
  | { ok: true; contactMode: ResearchContactImportMode; targetsCreated: number; targetsUpdated: number; contactsCreated: number; contactsUpdated: number; contactsUnlinked: number }
  | { ok: false; error: string };

type EnrichContactResult =
  | { ok: true; email: string; score: number | null; provider: "Hunter" | "Voila Norbert" | "Existing record" }
  | { ok: false; error: string };

const enrichContactSchema = z.object({
  opportunityId: z.uuid(),
  contactId: z.uuid(),
});

const researchThemeSchema = z.object({
  themeId: z.uuid().nullable().optional(),
  title: z.string().trim().min(2).max(220),
  audience: z.string().trim().max(2_000).default(""),
  problem: z.string().trim().max(10_000).default(""),
  signal: z.string().trim().max(10_000).default(""),
  angle: z.string().trim().max(10_000).default(""),
  status: z.enum(["idea", "evidence", "ready"]).default("idea"),
  offerId: z.uuid().nullable().default(null),
  sourceUrls: z.array(httpUrl).max(50).default([]),
});
type SaveResearchThemeResult = { ok: true; theme: ResearchThemeSummary } | { ok: false; error: string };
type DeleteResearchThemeResult = { ok: true } | { ok: false; error: string };
type ReorderResearchThemesResult = { ok: true } | { ok: false; error: string };

export async function saveResearchThemeAction(input: unknown): Promise<SaveResearchThemeResult> {
  const parsed = researchThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That research theme is invalid." };
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Research themes cannot be saved in the reset-on-refresh demo." };
  const data = parsed.data;
  const id = data.themeId ?? crypto.randomUUID();
  const updatedAt = new Date();
  try {
    if (member.storageMode === "sqlite") {
      let saved: ResearchThemeSummary | null = null;
      updateLocalBoardSnapshot((snapshot) => {
        snapshot.researchThemes ??= [];
        const existing = snapshot.researchThemes.find((theme) => theme.id === id);
        const position = existing?.position ?? Math.max(0, ...snapshot.researchThemes.map((theme) => theme.position)) + 1000;
        saved = { id, position, title: data.title, audience: data.audience || null, problem: data.problem || null, signal: data.signal || null, angle: data.angle || null, status: data.status, offerId: data.offerId, sourceUrls: data.sourceUrls, updatedAt: updatedAt.toISOString() };
        if (existing) Object.assign(existing, saved);
        else snapshot.researchThemes.push(saved);
      });
      recordLocalAuditEvent({ actorId: member.id, action: "research_theme.saved", entityType: "research_theme", entityId: id, detail: { status: data.status, offerId: data.offerId } });
      revalidatePath("/research");
      return { ok: true, theme: saved! };
    }
    const values = { title: data.title, audience: data.audience || null, problem: data.problem || null, signal: data.signal || null, angle: data.angle || null, status: data.status, offerId: data.offerId, sourceUrls: data.sourceUrls, ownerId: member.id, updatedAt };
    let row;
    if (data.themeId) {
      [row] = await db.update(researchThemes).set(values).where(and(eq(researchThemes.id, id), eq(researchThemes.organisationId, member.organisationId))).returning();
    } else {
      const [{ highestPosition }] = await db.select({ highestPosition: max(researchThemes.position) }).from(researchThemes).where(eq(researchThemes.organisationId, member.organisationId));
      [row] = await db.insert(researchThemes).values({ id, organisationId: member.organisationId, position: (highestPosition ?? 0) + 1000, ...values }).returning();
    }
    if (!row) return { ok: false, error: "Research theme not found." };
    await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "research_theme.saved", entityType: "research_theme", entityId: row.id, after: { status: row.status, offerId: row.offerId } });
    revalidatePath("/research");
    return { ok: true, theme: { id: row.id, position: row.position, title: row.title, audience: row.audience, problem: row.problem, signal: row.signal, angle: row.angle, status: row.status === "ready" ? "ready" : row.status === "evidence" ? "evidence" : "idea", offerId: row.offerId, sourceUrls: row.sourceUrls, updatedAt: row.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Research theme could not be saved.") };
  }
}

export async function reorderResearchThemesAction(input: unknown): Promise<ReorderResearchThemesResult> {
  const parsed = z.object({ themeIds: z.array(z.uuid()).min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid idea order." };
  if (new Set(parsed.data.themeIds).size !== parsed.data.themeIds.length) return { ok: false, error: "Choose a valid idea order." };
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Idea ordering is fixed in the reset-on-refresh demo." };

  try {
    if (member.storageMode === "sqlite") {
      const existingIds = getLocalBoardSnapshot().researchThemes.map((theme) => theme.id);
      if (existingIds.length !== parsed.data.themeIds.length || existingIds.some((id) => !parsed.data.themeIds.includes(id))) return { ok: false, error: "The idea list changed. Refresh and try again." };
      updateLocalBoardSnapshot((snapshot) => {
        const positions = new Map(parsed.data.themeIds.map((id, index) => [id, (index + 1) * 1000]));
        snapshot.researchThemes = snapshot.researchThemes
          .map((theme) => ({ ...theme, position: positions.get(theme.id) ?? theme.position }))
          .sort((a, b) => a.position - b.position);
      });
      recordLocalAuditEvent({ actorId: member.id, action: "research_theme.reordered", entityType: "research_theme", entityId: member.organisationId, detail: { count: parsed.data.themeIds.length } });
    } else {
      const existing = await db.select({ id: researchThemes.id }).from(researchThemes).where(eq(researchThemes.organisationId, member.organisationId));
      const existingIds = existing.map((theme) => theme.id);
      if (existingIds.length !== parsed.data.themeIds.length || existingIds.some((id) => !parsed.data.themeIds.includes(id))) return { ok: false, error: "The idea list changed. Refresh and try again." };
      await db.transaction(async (tx) => {
        for (const [index, themeId] of parsed.data.themeIds.entries()) {
          await tx.update(researchThemes).set({ position: (index + 1) * 1000 }).where(and(eq(researchThemes.id, themeId), eq(researchThemes.organisationId, member.organisationId)));
        }
        await tx.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "research_theme.reordered", entityType: "research_theme", entityId: member.organisationId, after: { count: parsed.data.themeIds.length } });
      });
    }
    revalidatePath("/research");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The idea order could not be saved.") };
  }
}

export async function deleteResearchThemeAction(input: unknown): Promise<DeleteResearchThemeResult> {
  const parsed = z.object({ themeId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid research idea." };
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Research ideas cannot be deleted in the reset-on-refresh demo." };

  try {
    if (member.storageMode === "sqlite") {
      const deleted = getLocalBoardSnapshot().researchThemes.find((theme) => theme.id === parsed.data.themeId) ?? null;
      if (!deleted) return { ok: false, error: "Research idea not found." };
      updateLocalBoardSnapshot((snapshot) => {
        snapshot.researchThemes = snapshot.researchThemes.filter((theme) => theme.id !== parsed.data.themeId);
      });
      recordLocalAuditEvent({ actorId: member.id, action: "research_theme.deleted", entityType: "research_theme", entityId: parsed.data.themeId, detail: { title: deleted.title } });
      revalidatePath("/research");
      return { ok: true };
    }

    const [deleted] = await db.delete(researchThemes)
      .where(and(eq(researchThemes.id, parsed.data.themeId), eq(researchThemes.organisationId, member.organisationId)))
      .returning({ id: researchThemes.id, title: researchThemes.title });
    if (!deleted) return { ok: false, error: "Research idea not found." };
    await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "research_theme.deleted", entityType: "research_theme", entityId: deleted.id, before: { title: deleted.title } });
    revalidatePath("/research");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Research idea could not be deleted.") };
  }
}

export async function enrichResearchContactAction(input: unknown): Promise<EnrichContactResult> {
  const parsed = enrichContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid research contact." };
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Enrichment is disabled in the reset-on-refresh demo." };

  try {
    const freeMaxStatus = await getFreeMaxStatus(member.organisationId, member.storageMode);
    const freeMaxConfiguration = await getFreeMaxRuntimeConfiguration(member.organisationId, member.storageMode);
    if (member.storageMode === "sqlite") {
      const snapshot = getLocalBoardSnapshot();
      const opportunity = snapshot.opportunities.find((item) => item.id === parsed.data.opportunityId);
      const contact = opportunity?.contacts.find((item) => item.id === parsed.data.contactId);
      if (!opportunity || !contact) return { ok: false, error: "That research contact is no longer available." };
      if (opportunity.company.doNotContact || contact.doNotContact) return { ok: false, error: "This record is marked do not contact." };
      if (contact.email) return { ok: true, email: contact.email, score: null, provider: "Existing record" };
      const domain = extractDomain(opportunity.company.websiteUrl ?? "");
      if (!domain) return { ok: false, error: "Add the company website before looking up a work email." };
      const result = await findWorkEmailFreeMax(
        { domain, fullName: contact.name },
        freeMaxStatus,
        freeMaxConfiguration.keys,
      );
      if (!result.found) return { ok: false, error: result.message };
      updateLocalBoardSnapshot((current) => {
        const currentContact = current.opportunities.find((item) => item.id === opportunity.id)?.contacts.find((item) => item.id === contact.id);
        if (!currentContact) throw new Error("That research contact is no longer available.");
        currentContact.email = result.email;
        currentContact.preferredChannel ??= "email";
        currentContact.sourceUrls = uniqueUrls(currentContact.sourceUrls, result.sourceUrls);
      });
      recordLocalFreeMaxSuccess(result.provider);
      recordLocalAuditEvent({
        actorId: member.id,
        action: "contact.enriched",
        entityType: "contact",
        entityId: contact.id,
        detail: { opportunityId: opportunity.id, provider: result.provider, score: result.score, attempts: result.attempts },
      });
      revalidateResearchPaths();
      return { ok: true, email: result.email, score: result.score, provider: providerLabel(result.provider) };
    }

    const [record] = await db.select({
      company: companies,
      contact: contacts,
      opportunityId: opportunities.id,
    }).from(opportunities)
      .innerJoin(companies, eq(opportunities.companyId, companies.id))
      .innerJoin(opportunityContacts, eq(opportunityContacts.opportunityId, opportunities.id))
      .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
      .where(and(
        eq(opportunities.id, parsed.data.opportunityId),
        eq(opportunities.organisationId, member.organisationId),
        eq(contacts.id, parsed.data.contactId),
    )).limit(1);
    if (!record) return { ok: false, error: "That research contact is no longer available." };
    if (record.company.doNotContact || record.contact.doNotContact) return { ok: false, error: "This record is marked do not contact." };
    if (record.contact.email) return { ok: true, email: record.contact.email, score: null, provider: "Existing record" };
    const domain = extractDomain(record.company.websiteUrl ?? "");
    if (!domain) return { ok: false, error: "Add the company website before looking up a work email." };
    const result = await findWorkEmailFreeMax(
      { domain, fullName: record.contact.name },
      freeMaxStatus,
      freeMaxConfiguration.keys,
    );
    if (!result.found) return { ok: false, error: result.message };

    await db.transaction(async (tx) => {
      await tx.update(contacts).set({
        email: result.email,
        preferredChannel: record.contact.preferredChannel ?? "email",
        sourceUrls: uniqueUrls(record.contact.sourceUrls, result.sourceUrls),
        updatedAt: new Date(),
      }).where(eq(contacts.id, record.contact.id));
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "contact.enriched",
        entityType: "contact",
        entityId: record.contact.id,
        after: { opportunityId: record.opportunityId, provider: result.provider, score: result.score, attempts: result.attempts },
      });
    });
    revalidateResearchPaths();
    return { ok: true, email: result.email, score: result.score, provider: providerLabel(result.provider) };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The email lookup could not be completed.") };
  }
}

export async function importResearchResultsAction(input: unknown): Promise<ResearchImportResult> {
  const parsed = parseResearchImport(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "The research file is not valid." };
  }

  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Research cannot be imported into the reset-on-refresh demo." };

  try {
    const report = member.storageMode === "sqlite"
      ? importIntoLocalSnapshot(parsed.data.targets, parsed.data.contactMode, member.id)
      : await importIntoPostgres(parsed.data.targets, parsed.data.contactMode, member.organisationId, member.id);

    recordLocalAuditEventIfNeeded(member.storageMode, {
      actorId: member.id,
      detail: { contactMode: parsed.data.contactMode, ...report, suppliedTargets: parsed.data.targets.length },
    });
    revalidateResearchPaths();
    return { ok: true, contactMode: parsed.data.contactMode, ...report };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The research results could not be imported.") };
  }
}

function importIntoLocalSnapshot(targets: ResearchTargetInput[], contactMode: ResearchContactImportMode, actorId: string) {
  return updateLocalBoardSnapshot((snapshot) => {
    const researchStage = snapshot.stages.find((stage) => stage.name === "Researching");
    if (!researchStage) throw new Error("The Researching stage is not configured.");
    const actor = snapshot.users.find((user) => user.id === actorId) ?? null;
    let targetsCreated = 0;
    let targetsUpdated = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let contactsUnlinked = 0;

    for (const result of targets) {
      const resolvedOffer = resolveImportedOffer(snapshot.offers, result.offerId, result.offerName);
      const multiOffer = snapshot.offers.filter((offer) => offer.active).length > 1;
      const domain = extractDomain(result.websiteUrl);
      const nameKey = normaliseName(result.name);
      let opportunity = snapshot.opportunities.find((item) =>
        item.id === result.opportunityId ||
        (item.company.id === result.companyId && (resolvedOffer ? item.offer?.id === resolvedOffer.id : multiOffer ? !item.offer : true)),
      );
      opportunity ??= snapshot.opportunities.find((item) =>
        ((domain && extractDomain(item.company.websiteUrl ?? "") === domain) ||
        normaliseName(item.company.name) === nameKey) &&
        (resolvedOffer ? item.offer?.id === resolvedOffer.id : multiOffer ? !item.offer : true),
      );

      if (!opportunity) {
        const company = mergeCompany(null, result);
        opportunity = {
          id: crypto.randomUUID(),
          stageId: researchStage.id,
          position: Math.max(0, ...snapshot.opportunities.filter((item) => item.stageId === researchStage.id).map((item) => item.position)) + 1000,
          offer: resolvedOffer,
          company,
          title: `${company.name} research`,
          priority: result.fitScore === 5 ? "high" : result.fitScore && result.fitScore >= 3 ? "medium" : "low",
          temperature: "cold",
          owner: actor,
          outreachAngle: null,
          lastActivityAt: null,
          nextActionAt: null,
          noNextActionReason: "Research imported; review before promotion",
          contacts: [],
          activities: [],
          tasks: [],
          recentChannels: [],
          aiSuggestions: [],
        };
        snapshot.opportunities.unshift(opportunity);
        targetsCreated += 1;
      } else {
        if ((result.offerId || result.offerName) && resolvedOffer) opportunity.offer = resolvedOffer;
        const company = mergeCompany(opportunity.company, result);
        for (const item of snapshot.opportunities) {
          if (item.company.id === company.id) item.company = { ...company };
        }
        if (opportunity.stageId === researchStage.id) {
          opportunity.noNextActionReason = "Research updated; review before promotion";
        }
        targetsUpdated += 1;
      }

      const companyOpportunities = snapshot.opportunities.filter((item) => item.company.id === opportunity.company.id);
      const companyContactRecords = uniqueLocalContactRecords(companyOpportunities.flatMap((item) => item.contacts));
      const reconciled = reconcileResearchContacts({
        records: companyContactRecords,
        associations: opportunity.contacts.map((contact) => ({ contactId: contact.id, primary: contact.primary })),
        incoming: result.contacts ?? [],
        mode: contactMode,
        createId: () => crypto.randomUUID(),
      });
      applyLocalContactReconciliation(companyOpportunities, opportunity.id, reconciled.records, reconciled.associations);
      contactsCreated += reconciled.createdIds.length;
      contactsUpdated += reconciled.updatedIds.length;
      contactsUnlinked += reconciled.unlinkedIds.length;
    }

    return { targetsCreated, targetsUpdated, contactsCreated, contactsUpdated, contactsUnlinked };
  });
}

async function importIntoPostgres(targets: ResearchTargetInput[], contactMode: ResearchContactImportMode, organisationId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [pipeline] = await tx.select().from(pipelines).where(and(
      eq(pipelines.organisationId, organisationId),
      eq(pipelines.active, true),
    )).limit(1);
    if (!pipeline) throw new Error("No active pipeline is configured.");
    const [researchStage] = await tx.select().from(stages).where(and(
      eq(stages.pipelineId, pipeline.id),
      eq(stages.name, "Researching"),
      eq(stages.active, true),
    )).limit(1);
    if (!researchStage) throw new Error("The Researching stage is not configured.");
    const offerRows = await tx.select().from(offers).where(and(
      eq(offers.organisationId, organisationId),
      eq(offers.active, true),
    ));

    let targetsCreated = 0;
    let targetsUpdated = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let contactsUnlinked = 0;

    for (const result of targets) {
      const resolvedOffer = resolveImportedOffer(offerRows.map((offer) => ({
        id: offer.id,
        name: offer.name,
        colour: offer.colour,
        description: offer.description,
        idealCustomer: offer.idealCustomer,
        positioning: offer.positioning,
        isDefault: offer.isDefault,
        active: offer.active,
        position: offer.position,
      })), result.offerId, result.offerName);
      const domain = extractDomain(result.websiteUrl);
      const nameKey = normaliseName(result.name);
      const companyCondition = result.companyId
        ? eq(companies.id, result.companyId)
        : domain
          ? or(eq(companies.normalisedDomain, domain), eq(companies.normalisedName, nameKey))
          : eq(companies.normalisedName, nameKey);
      let [company] = await tx.select().from(companies).where(and(
        eq(companies.organisationId, organisationId),
        companyCondition,
      )).limit(1);

      if (company) {
        const merged = mergeCompany({
          id: company.id,
          name: company.name,
          sector: company.sector,
          websiteUrl: company.websiteUrl,
          linkedinUrl: company.linkedinUrl,
          fitScore: company.fitScore,
          scaleNote: company.scaleNote,
          researchNote: company.researchNote,
          sourceUrls: company.sourceUrls,
          doNotContact: company.doNotContact,
        }, result);
        [company] = await tx.update(companies).set({
          name: merged.name,
          normalisedName: normaliseName(merged.name),
          domain: extractDomain(merged.websiteUrl ?? ""),
          normalisedDomain: extractDomain(merged.websiteUrl ?? ""),
          websiteUrl: merged.websiteUrl,
          linkedinUrl: merged.linkedinUrl,
          sector: merged.sector,
          fitScore: merged.fitScore,
          scaleNote: merged.scaleNote,
          researchNote: merged.researchNote,
          sourceUrls: merged.sourceUrls ?? [],
          updatedAt: new Date(),
        }).where(eq(companies.id, company.id)).returning();
        targetsUpdated += 1;
      } else {
        const merged = mergeCompany(null, result);
        [company] = await tx.insert(companies).values({
          organisationId,
          name: merged.name,
          normalisedName: normaliseName(merged.name),
          domain,
          normalisedDomain: domain,
          websiteUrl: merged.websiteUrl,
          linkedinUrl: merged.linkedinUrl,
          sector: merged.sector,
          fitScore: merged.fitScore,
          scaleNote: merged.scaleNote,
          researchNote: merged.researchNote,
          sourceUrls: merged.sourceUrls ?? [],
          importMetadata: { source: "research_pack" },
        }).returning();
        targetsCreated += 1;
      }

      let [opportunity] = result.opportunityId
        ? await tx.select().from(opportunities).where(and(
            eq(opportunities.id, result.opportunityId),
            eq(opportunities.organisationId, organisationId),
          )).limit(1)
        : [];
      if (!opportunity) {
        [opportunity] = await tx.select().from(opportunities).where(and(
          eq(opportunities.organisationId, organisationId),
          eq(opportunities.pipelineId, pipeline.id),
          eq(opportunities.companyId, company.id),
          resolvedOffer ? eq(opportunities.offerId, resolvedOffer.id) : offerRows.length > 1 ? isNull(opportunities.offerId) : undefined,
        )).limit(1);
      }
      if (!opportunity) {
        [opportunity] = await tx.insert(opportunities).values({
          organisationId,
          pipelineId: pipeline.id,
          companyId: company.id,
          stageId: researchStage.id,
          offerId: resolvedOffer?.id ?? null,
          ownerId: actorId,
          title: `${company.name} research`,
          priority: result.fitScore === 5 ? "high" : result.fitScore && result.fitScore >= 3 ? "medium" : "low",
          noNextActionReason: "Research imported; review before promotion",
          importMetadata: { source: "research_pack" },
        }).returning();
      } else if ((result.offerId || result.offerName) && resolvedOffer && opportunity.offerId !== resolvedOffer.id) {
        [opportunity] = await tx.update(opportunities).set({ offerId: resolvedOffer.id, updatedAt: new Date() })
          .where(eq(opportunities.id, opportunity.id)).returning();
      }

      const companyContactRows = await tx.select().from(contacts).where(and(
        eq(contacts.organisationId, organisationId),
        eq(contacts.companyId, company.id),
      ));
      const existingAssociations = await tx.select({
        contactId: opportunityContacts.contactId,
        primary: opportunityContacts.primary,
      }).from(opportunityContacts).where(eq(opportunityContacts.opportunityId, opportunity.id));
      const reconciled = reconcileResearchContacts({
        records: companyContactRows.map(toResearchContactRecord),
        associations: existingAssociations,
        incoming: result.contacts ?? [],
        mode: contactMode,
        createId: () => crypto.randomUUID(),
      });

      for (const contactId of reconciled.updatedIds) {
        const contact = reconciled.records.find((item) => item.id === contactId)!;
        await tx.update(contacts).set({
          name: contact.name,
          normalisedName: normaliseName(contact.name),
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          linkedinUrl: contact.linkedinUrl,
          preferredChannel: contact.preferredChannel,
          sourceUrls: contact.sourceUrls ?? [],
          updatedAt: new Date(),
        }).where(and(eq(contacts.id, contact.id), eq(contacts.organisationId, organisationId)));
      }
      for (const contactId of reconciled.createdIds) {
        const contact = reconciled.records.find((item) => item.id === contactId)!;
        await tx.insert(contacts).values({
          id: contact.id,
          organisationId,
          companyId: company.id,
          name: contact.name,
          normalisedName: normaliseName(contact.name),
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          linkedinUrl: contact.linkedinUrl,
          preferredChannel: contact.preferredChannel,
          doNotContact: contact.doNotContact,
          sourceUrls: contact.sourceUrls ?? [],
          source: "research_pack",
          importMetadata: { source: "research_pack" },
        });
      }
      for (const association of reconciled.associations) {
        await tx.insert(opportunityContacts).values({
          opportunityId: opportunity.id,
          contactId: association.contactId,
          primary: false,
        }).onConflictDoNothing();
      }
      for (const contactId of reconciled.unlinkedIds) {
        await tx.delete(opportunityContacts).where(and(
          eq(opportunityContacts.opportunityId, opportunity.id),
          eq(opportunityContacts.contactId, contactId),
        ));
      }
      await tx.update(opportunityContacts).set({ primary: false })
        .where(eq(opportunityContacts.opportunityId, opportunity.id));
      if (reconciled.primaryContactId) {
        await tx.update(opportunityContacts).set({ primary: true }).where(and(
          eq(opportunityContacts.opportunityId, opportunity.id),
          eq(opportunityContacts.contactId, reconciled.primaryContactId),
        ));
      }
      contactsCreated += reconciled.createdIds.length;
      contactsUpdated += reconciled.updatedIds.length;
      contactsUnlinked += reconciled.unlinkedIds.length;

      await tx.insert(auditEvents).values({
        organisationId,
        actorId,
        action: "research.imported",
        entityType: "opportunity",
        entityId: opportunity.id,
        after: {
          companyId: company.id,
          offerId: resolvedOffer?.id ?? null,
          contactMode,
          contactsSupplied: result.contacts?.length ?? 0,
          contactsCreated: reconciled.createdIds.length,
          contactsUpdated: reconciled.updatedIds.length,
          contactsUnlinked: reconciled.unlinkedIds.length,
          sources: result.sourceUrls.length + result.evidence.length,
        },
      });
    }

    const report = { targetsCreated, targetsUpdated, contactsCreated, contactsUpdated, contactsUnlinked };
    await tx.insert(auditEvents).values({
      organisationId,
      actorId,
      action: "research.imported",
      entityType: "research_batch",
      entityId: crypto.randomUUID(),
      after: { contactMode, ...report, suppliedTargets: targets.length },
    });
    return report;
  });
}

function resolveImportedOffer(offers: OfferSummary[], offerId?: string | null, offerName?: string) {
  const active = offers.filter((offer) => offer.active);
  if (offerId) {
    const matched = active.find((offer) => offer.id === offerId);
    if (!matched) throw new Error("A research target refers to an offer that is not available in this workspace.");
    return matched;
  }
  if (offerName) {
    const matched = active.find((offer) => normaliseName(offer.name) === normaliseName(offerName));
    if (!matched) throw new Error(`The offer \"${offerName}\" is not available in this workspace.`);
    return matched;
  }
  return active.length === 1 ? active[0] : null;
}

function mergeCompany(existing: CompanySummary | null, result: ResearchTargetInput): CompanySummary {
  const evidenceUrls = result.evidence.map((item) => item.url);
  const evidenceNote = result.evidence.length
    ? result.evidence.map((item) => `- ${item.claim}${item.observedAt ? ` (${item.observedAt})` : ""}`).join("\n")
    : "";
  return {
    ...(existing ?? { id: result.companyId ?? crypto.randomUUID(), doNotContact: false }),
    name: result.name || existing?.name || "Unnamed company",
    sector: result.sector || existing?.sector || null,
    websiteUrl: result.websiteUrl || existing?.websiteUrl || null,
    linkedinUrl: result.linkedinUrl || existing?.linkedinUrl || null,
    fitScore: result.fitScore ?? existing?.fitScore ?? null,
    scaleNote: result.scaleNote || existing?.scaleNote || null,
    researchNote: mergeParagraphs(existing?.researchNote, result.researchNote, evidenceNote),
    sourceUrls: uniqueUrls(existing?.sourceUrls, result.sourceUrls, evidenceUrls),
  };
}

function uniqueLocalContactRecords(localContacts: ContactSummary[]): ResearchContactRecord[] {
  const records = new Map<string, ResearchContactRecord>();
  for (const contact of localContacts) {
    const existing = records.get(contact.id);
    const next = toResearchContactRecord(contact);
    records.set(contact.id, existing ? {
      ...existing,
      name: next.name || existing.name,
      title: next.title || existing.title,
      email: next.email || existing.email,
      phone: next.phone || existing.phone,
      linkedinUrl: next.linkedinUrl || existing.linkedinUrl,
      preferredChannel: next.preferredChannel ?? existing.preferredChannel,
      doNotContact: existing.doNotContact || next.doNotContact,
      sourceUrls: uniqueUrls(existing.sourceUrls, next.sourceUrls),
    } : next);
  }
  return [...records.values()];
}

function applyLocalContactReconciliation(
  companyOpportunities: Array<{ id: string; contacts: ContactSummary[] }>,
  targetOpportunityId: string,
  records: ResearchContactRecord[],
  associations: ResearchContactAssociation[],
) {
  const recordsById = new Map(records.map((contact) => [contact.id, contact]));
  for (const opportunity of companyOpportunities) {
    if (opportunity.id === targetOpportunityId) {
      opportunity.contacts = associations.map((association) => ({
        ...recordsById.get(association.contactId)!,
        primary: association.primary,
      }));
      continue;
    }
    opportunity.contacts = opportunity.contacts.map((contact) => {
      const updated = recordsById.get(contact.id);
      return updated ? { ...updated, primary: contact.primary } : contact;
    });
  }
}

function toResearchContactRecord(contact: {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  preferredChannel?: ContactSummary["preferredChannel"];
  doNotContact: boolean;
  sourceUrls?: string[];
}): ResearchContactRecord {
  return {
    id: contact.id,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    linkedinUrl: contact.linkedinUrl,
    preferredChannel: contact.preferredChannel,
    doNotContact: contact.doNotContact,
    sourceUrls: contact.sourceUrls ?? [],
  };
}

function uniqueUrls(...collections: Array<string[] | undefined>) {
  return [...new Set(collections.flatMap((items) => items ?? []).filter(isSafeHttpUrl))];
}

function mergeParagraphs(...values: Array<string | null | undefined>) {
  const paragraphs = values.flatMap((value) => value?.split(/\n\s*\n/) ?? []).map((value) => value.trim()).filter(Boolean);
  return paragraphs.length ? [...new Set(paragraphs)].join("\n\n") : null;
}

function recordLocalAuditEventIfNeeded(storageMode: string, input: { actorId: string; detail: Record<string, unknown> }) {
  if (storageMode !== "sqlite") return;
  recordLocalAuditEvent({
    actorId: input.actorId,
    action: "research.imported",
    entityType: "research_batch",
    entityId: crypto.randomUUID(),
    detail: input.detail,
  });
}

function revalidateResearchPaths() {
  for (const path of ["/research", "/targets", "/pipeline", "/companies", "/search", "/reports"]) {
    revalidatePath(path);
  }
}
