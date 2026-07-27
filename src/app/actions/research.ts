"use server";

import { and, eq, isNull, or } from "drizzle-orm";
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
import { getCurrentMember } from "@/lib/session";

const httpUrl = z.url().refine(isSafeHttpUrl, "Only HTTP and HTTPS source links are allowed.");

const optionalUrl = z.string().trim().max(2_000).refine(
  (value) => !value || isSafeHttpUrl(value),
  "Source and profile links must be complete URLs.",
).optional().default("");

const researchContactSchema = z.object({
  name: z.string().trim().min(2).max(220),
  title: z.string().trim().max(255).optional().default(""),
  email: z.union([z.literal(""), z.email()]).optional().default(""),
  phone: z.string().trim().max(80).optional().default(""),
  linkedinUrl: optionalUrl,
  preferredChannel: z.enum(["linkedin", "email", "phone", "meeting", "physical", "note"]).nullable().optional(),
  sourceUrls: z.array(httpUrl).max(30).optional().default([]),
});

const researchEvidenceSchema = z.object({
  claim: z.string().trim().min(2).max(2_000),
  url: httpUrl,
  observedAt: z.string().trim().max(80).optional().default(""),
});

const researchTargetSchema = z.object({
  opportunityId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  offerId: z.uuid().nullable().optional(),
  offerName: z.string().trim().max(160).optional().default(""),
  name: z.string().trim().min(2).max(220),
  websiteUrl: optionalUrl,
  linkedinUrl: optionalUrl,
  sector: z.string().trim().max(160).optional().default(""),
  fitScore: z.number().int().min(1).max(5).nullable().optional(),
  scaleNote: z.string().trim().max(2_000).optional().default(""),
  researchNote: z.string().trim().max(10_000).optional().default(""),
  sourceUrls: z.array(httpUrl).max(100).optional().default([]),
  evidence: z.array(researchEvidenceSchema).max(100).optional().default([]),
  contacts: z.array(researchContactSchema).max(20).optional().default([]),
});

const researchImportSchema = z.object({
  schemaVersion: z.number().int().optional(),
  targets: z.array(researchTargetSchema).min(1).max(500),
});

type ResearchTargetInput = z.infer<typeof researchTargetSchema>;
type ResearchImportResult =
  | { ok: true; targetsCreated: number; targetsUpdated: number; contactsCreated: number }
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
        saved = { id, title: data.title, audience: data.audience || null, problem: data.problem || null, signal: data.signal || null, angle: data.angle || null, status: data.status, offerId: data.offerId, sourceUrls: data.sourceUrls, updatedAt: updatedAt.toISOString() };
        if (existing) Object.assign(existing, saved);
        else snapshot.researchThemes.unshift(saved);
      });
      recordLocalAuditEvent({ actorId: member.id, action: "research_theme.saved", entityType: "research_theme", entityId: id, detail: { status: data.status, offerId: data.offerId } });
      revalidatePath("/research");
      return { ok: true, theme: saved! };
    }
    const values = { title: data.title, audience: data.audience || null, problem: data.problem || null, signal: data.signal || null, angle: data.angle || null, status: data.status, offerId: data.offerId, sourceUrls: data.sourceUrls, ownerId: member.id, updatedAt };
    const [row] = data.themeId
      ? await db.update(researchThemes).set(values).where(and(eq(researchThemes.id, id), eq(researchThemes.organisationId, member.organisationId))).returning()
      : await db.insert(researchThemes).values({ id, organisationId: member.organisationId, ...values }).returning();
    if (!row) return { ok: false, error: "Research theme not found." };
    await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "research_theme.saved", entityType: "research_theme", entityId: row.id, after: { status: row.status, offerId: row.offerId } });
    revalidatePath("/research");
    return { ok: true, theme: { id: row.id, title: row.title, audience: row.audience, problem: row.problem, signal: row.signal, angle: row.angle, status: row.status === "ready" ? "ready" : row.status === "evidence" ? "evidence" : "idea", offerId: row.offerId, sourceUrls: row.sourceUrls, updatedAt: row.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Research theme could not be saved.") };
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
  const normalisedInput = Array.isArray(input) ? { targets: input } : input;
  const parsed = researchImportSchema.safeParse(normalisedInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "The research file is not valid." };
  }

  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.demoMode) return { ok: false, error: "Research cannot be imported into the reset-on-refresh demo." };

  try {
    const report = member.storageMode === "sqlite"
      ? importIntoLocalSnapshot(parsed.data.targets, member.id)
      : await importIntoPostgres(parsed.data.targets, member.organisationId, member.id);

    recordLocalAuditEventIfNeeded(member.storageMode, {
      actorId: member.id,
      detail: { ...report, suppliedTargets: parsed.data.targets.length },
    });
    revalidateResearchPaths();
    return { ok: true, ...report };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The research results could not be imported.") };
  }
}

function importIntoLocalSnapshot(targets: ResearchTargetInput[], actorId: string) {
  return updateLocalBoardSnapshot((snapshot) => {
    const researchStage = snapshot.stages.find((stage) => stage.name === "Researching");
    if (!researchStage) throw new Error("The Researching stage is not configured.");
    const actor = snapshot.users.find((user) => user.id === actorId) ?? null;
    let targetsCreated = 0;
    let targetsUpdated = 0;
    let contactsCreated = 0;

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

      for (const incoming of result.contacts) {
        const contact = opportunity.contacts.find((item) => contactMatches(item, incoming));
        if (contact) {
          contact.title = incoming.title || contact.title;
          contact.email = incoming.email || contact.email;
          contact.phone = incoming.phone || contact.phone;
          contact.linkedinUrl = incoming.linkedinUrl || contact.linkedinUrl;
          contact.preferredChannel = incoming.preferredChannel ?? contact.preferredChannel;
          contact.sourceUrls = uniqueUrls(contact.sourceUrls, incoming.sourceUrls);
        } else {
          opportunity.contacts.push({
            id: crypto.randomUUID(),
            name: incoming.name,
            title: incoming.title || null,
            email: incoming.email || null,
            phone: incoming.phone || null,
            linkedinUrl: incoming.linkedinUrl || null,
            primary: opportunity.contacts.length === 0,
            preferredChannel: incoming.preferredChannel ?? preferredChannelFor(incoming),
            doNotContact: false,
            sourceUrls: incoming.sourceUrls,
          });
          contactsCreated += 1;
        }
      }
    }

    return { targetsCreated, targetsUpdated, contactsCreated };
  });
}

async function importIntoPostgres(targets: ResearchTargetInput[], organisationId: string, actorId: string) {
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

      for (const incoming of result.contacts) {
        const contactCondition = incoming.email
          ? or(eq(contacts.email, incoming.email), eq(contacts.normalisedName, normaliseName(incoming.name)))
          : eq(contacts.normalisedName, normaliseName(incoming.name));
        let [contact] = await tx.select().from(contacts).where(and(
          eq(contacts.organisationId, organisationId),
          eq(contacts.companyId, company.id),
          contactCondition,
        )).limit(1);
        if (contact) {
          [contact] = await tx.update(contacts).set({
            title: incoming.title || contact.title,
            email: incoming.email || contact.email,
            phone: incoming.phone || contact.phone,
            linkedinUrl: incoming.linkedinUrl || contact.linkedinUrl,
            preferredChannel: incoming.preferredChannel ?? contact.preferredChannel,
            sourceUrls: uniqueUrls(contact.sourceUrls, incoming.sourceUrls),
            updatedAt: new Date(),
          }).where(eq(contacts.id, contact.id)).returning();
        } else {
          [contact] = await tx.insert(contacts).values({
            organisationId,
            companyId: company.id,
            name: incoming.name,
            normalisedName: normaliseName(incoming.name),
            title: incoming.title || null,
            email: incoming.email || null,
            phone: incoming.phone || null,
            linkedinUrl: incoming.linkedinUrl || null,
            preferredChannel: incoming.preferredChannel ?? preferredChannelFor(incoming),
            sourceUrls: incoming.sourceUrls,
            source: "research_pack",
            importMetadata: { source: "research_pack" },
          }).returning();
          contactsCreated += 1;
        }
        await tx.insert(opportunityContacts).values({
          opportunityId: opportunity.id,
          contactId: contact.id,
          primary: false,
        }).onConflictDoNothing();
      }

      await tx.insert(auditEvents).values({
        organisationId,
        actorId,
        action: "research.imported",
        entityType: "opportunity",
        entityId: opportunity.id,
        after: { companyId: company.id, offerId: resolvedOffer?.id ?? null, contacts: result.contacts.length, sources: result.sourceUrls.length + result.evidence.length },
      });
    }

    return { targetsCreated, targetsUpdated, contactsCreated };
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

function contactMatches(existing: ContactSummary, incoming: z.infer<typeof researchContactSchema>) {
  return Boolean(
    (incoming.email && existing.email?.toLowerCase() === incoming.email.toLowerCase()) ||
    (incoming.linkedinUrl && existing.linkedinUrl === incoming.linkedinUrl) ||
    normaliseName(existing.name) === normaliseName(incoming.name),
  );
}

function preferredChannelFor(contact: z.infer<typeof researchContactSchema>) {
  if (contact.email) return "email" as const;
  if (contact.phone) return "phone" as const;
  if (contact.linkedinUrl) return "linkedin" as const;
  return null;
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
  for (const path of ["/research", "/pipeline", "/companies", "/search", "/reports"]) {
    revalidatePath(path);
  }
}
