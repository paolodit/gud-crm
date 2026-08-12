"use server";

import { and, eq, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { publicActionError } from "@/lib/action-error";
import {
  activities,
  activityTypes,
  auditEvents,
  companies,
  contacts,
  opportunities,
  offers,
  opportunityContacts,
  pipelines,
  stageHistory,
  stages,
  tasks,
  users,
} from "@/db/schema";
import { extractDomain, isSafeHttpUrl, normaliseHttpUrlInput, normaliseName } from "@/lib/domain/normalise";
import { isActivityTimeAllowed } from "@/lib/domain/activity";
import { activeOffers } from "@/lib/domain/offers";
import { recordLocalAuditEvent, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import { getCurrentMember } from "@/lib/session";
import type { ActivityTypeSummary, BoardSnapshot, CompanySummary, ContactSummary, OfferSummary } from "@/lib/domain/types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateActionResult =
  | { ok: true; opportunityId: string; companyId: string }
  | { ok: false; error: string };
type SaveContactResult =
  | { ok: true; contact: ContactSummary }
  | { ok: false; error: string };
type SaveActivityTypeResult =
  | { ok: true; activityType: ActivityTypeSummary }
  | { ok: false; error: string };
type SaveCompanyResult =
  | { ok: true; company: CompanySummary; opportunityId: string | null }
  | { ok: false; error: string };

const moveOpportunitySchema = z.object({
  opportunityId: z.uuid(),
  toStageId: z.uuid(),
});

const reorderOpportunitySchema = z.object({
  opportunityId: z.uuid(),
  toStageId: z.uuid(),
  orderedOpportunityIds: z.array(z.uuid()).min(1).max(10_000),
}).refine((value) => new Set(value.orderedOpportunityIds).size === value.orderedOpportunityIds.length, {
  message: "The requested card order contains duplicates.",
});

const logActivitySchema = z.object({
  opportunityId: z.uuid(),
  activityTypeId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  outcome: z.string().trim().max(220).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  occurredAt: z.coerce.date().refine(isActivityTimeAllowed, "Activity time cannot be in the future."),
  nextActionTitle: z.string().trim().min(2).max(240).optional(),
  nextActionAt: z.coerce.date().optional(),
});

const completeTaskSchema = z.object({ taskId: z.uuid() });

const optionalUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => !value || isSafeHttpUrl(value), "Enter a complete HTTP or HTTPS URL.");

const createOpportunitySchema = z
  .object({
    companyName: z.string().trim().min(2).max(220),
    websiteUrl: optionalUrl.default(""),
    companyLinkedinUrl: optionalUrl.default(""),
    sector: z.string().trim().max(160).default(""),
    fitScore: z.number().int().min(1).max(5).nullable().default(null),
    title: z.string().trim().min(2).max(220),
    offerId: z.uuid().nullable().default(null),
    stageId: z.uuid(),
    ownerId: z.string().trim().min(1).nullable().default(null),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    temperature: z.enum(["cold", "warm", "hot", "at_risk", "unresponsive"]).default("cold"),
    expectedValue: z.number().min(0).max(999_999_999).nullable().default(null),
    probability: z.number().int().min(0).max(100).nullable().default(null),
    expectedCloseDate: z.coerce.date().nullable().default(null),
    outreachAngle: z.string().trim().max(10_000).default(""),
    contactName: z.string().trim().max(220).default(""),
    contactTitle: z.string().trim().max(255).default(""),
    contactEmail: z.union([z.literal(""), z.email()]).default(""),
    contactPhone: z.string().trim().max(80).default(""),
    contactLinkedinUrl: optionalUrl.default(""),
    nextActionTitle: z.string().trim().max(240).default(""),
    nextActionAt: z.coerce.date().nullable().default(null),
  })
  .refine(
    (value) => Boolean(value.nextActionTitle) === Boolean(value.nextActionAt),
    { message: "Add both a next action and its due date." },
  );

const saveContactSchema = z.object({
  opportunityId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(220),
  title: z.string().trim().max(255).default(""),
  email: z.union([z.literal(""), z.email()]).default(""),
  phone: z.string().trim().max(80).default(""),
  linkedinUrl: optionalUrl.default(""),
  preferredChannel: z.enum(["linkedin", "email", "phone", "meeting", "physical", "note"]).nullable().default(null),
  doNotContact: z.boolean().default(false),
  primary: z.boolean().default(false),
});

const saveActivityTypeSchema = z.object({
  activityTypeId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(140),
  channel: z.enum(["linkedin", "email", "phone", "meeting", "physical", "note"]),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i, "Choose a valid colour."),
});

const saveCompanySchema = z.object({
  companyId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(220),
  sector: z.string().trim().max(160).default(""),
  websiteUrl: optionalUrl.default(""),
  linkedinUrl: optionalUrl.default(""),
  fitScore: z.number().int().min(1).max(5).nullable().default(null),
  scaleNote: z.string().trim().max(2_000).default(""),
  researchNote: z.string().trim().max(10_000).default(""),
  offerId: z.uuid().nullable().default(null),
});

const saveOpportunityDetailsSchema = z.object({
  opportunityId: z.uuid(),
  title: z.string().trim().min(2).max(220),
  offerId: z.uuid().nullable(),
  ownerId: z.string().trim().min(1).nullable(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  temperature: z.enum(["cold", "warm", "hot", "at_risk", "unresponsive"]),
  expectedValue: z.number().min(0).max(999_999_999).nullable(),
  probability: z.number().int().min(0).max(100).nullable(),
  expectedCloseDate: z.coerce.date().nullable(),
  outreachAngle: z.string().trim().max(10_000).default(""),
});

function chooseLocalOffer(snapshot: BoardSnapshot, offerId: string | null, allowUnassigned: boolean): OfferSummary | null {
  const active = activeOffers(snapshot.offers);
  if (offerId) {
    const chosen = active.find((offer) => offer.id === offerId);
    if (!chosen) throw new Error("That offer is not available.");
    return chosen;
  }
  if (allowUnassigned) return active.length === 1 ? active[0] : null;
  const chosen = active.length === 1 ? active[0] : null;
  if (!chosen) throw new Error("Choose what you are pitching.");
  return chosen;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolvePostgresOfferId(tx: DbTransaction, organisationId: string, offerId: string | null, allowUnassigned: boolean) {
  const rows = await tx.select({ id: offers.id, isDefault: offers.isDefault }).from(offers).where(and(
    eq(offers.organisationId, organisationId),
    eq(offers.active, true),
  ));
  if (offerId) {
    const chosen = rows.find((offer) => offer.id === offerId);
    if (!chosen) throw new Error("That offer is not available.");
    return chosen.id;
  }
  if (allowUnassigned) return rows.length === 1 ? rows[0].id : null;
  if (rows.length === 1) return rows[0].id;
  throw new Error("Choose what you are pitching.");
}

async function requireMember() {
  const member = await getCurrentMember();
  if (!member) throw new Error("You must be signed in.");
  return member;
}

export async function saveCompanyAction(input: unknown): Promise<SaveCompanyResult> {
  const parsed = saveCompanySchema.safeParse(normaliseCompanyUrls(input));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the company details." };

  try {
    const member = await requireMember();
    if (member.demoMode) return { ok: false, error: "Companies cannot be edited in the reset-on-refresh demo." };
    const data = parsed.data;

    if (member.storageMode === "sqlite") {
      let opportunityId: string | null = null;
      const saved = updateLocalBoardSnapshot((snapshot): CompanySummary => {
        const normalised = normaliseName(data.name);
        const duplicate = snapshot.opportunities.find((item) =>
          item.company.id !== data.companyId && normaliseName(item.company.name) === normalised,
        );
        if (duplicate) throw new Error("A company with that name already exists.");

        const existing = data.companyId
          ? snapshot.opportunities.find((item) => item.company.id === data.companyId)?.company
          : null;
        if (data.companyId && !existing) throw new Error("That company is not available.");
        const company: CompanySummary = {
          ...(existing ?? {
            id: crypto.randomUUID(),
            doNotContact: false,
            sourceUrls: [],
          }),
          name: data.name,
          sector: data.sector || null,
          websiteUrl: data.websiteUrl || null,
          linkedinUrl: data.linkedinUrl || null,
          fitScore: data.fitScore,
          scaleNote: data.scaleNote || null,
          researchNote: data.researchNote || null,
        };

        if (existing) {
          for (const opportunity of snapshot.opportunities) {
            if (opportunity.company.id === company.id) opportunity.company = { ...company };
          }
        } else {
          const researchStage = snapshot.stages.find((stage) => stage.name === "Researching") ?? snapshot.stages[0];
          if (!researchStage) throw new Error("No pipeline stage is configured.");
          opportunityId = crypto.randomUUID();
          snapshot.opportunities.unshift({
            id: opportunityId,
            stageId: researchStage.id,
            position: Math.max(0, ...snapshot.opportunities.filter((item) => item.stageId === researchStage.id).map((item) => item.position)) + 1000,
            offer: chooseLocalOffer(snapshot, data.offerId, true),
            company,
            title: `${company.name} research`,
            priority: "medium",
            temperature: "cold",
            expectedValue: null,
            probability: null,
            expectedCloseDate: null,
            owner: snapshot.users.find((user) => user.id === member.id) ?? null,
            outreachAngle: null,
            lastActivityAt: null,
            nextActionAt: null,
            noNextActionReason: "Researching fit and the right contact",
            contacts: [],
            activities: [],
            tasks: [],
            recentChannels: [],
            aiSuggestions: [],
          });
        }
        return company;
      });
      recordLocalAuditEvent({
        actorId: member.id,
        action: data.companyId ? "company.updated" : "company.created",
        entityType: "company",
        entityId: saved.id,
        detail: { name: saved.name, opportunityId },
      });
      revalidatePath("/companies");
      revalidatePath("/pipeline");
      return { ok: true, company: saved, opportunityId };
    }

    let opportunityId: string | null = null;
    const saved = await db.transaction(async (tx): Promise<CompanySummary> => {
      const normalised = normaliseName(data.name);
      const [duplicate] = await tx.select({ id: companies.id }).from(companies).where(and(
        eq(companies.organisationId, member.organisationId),
        eq(companies.normalisedName, normalised),
        data.companyId ? ne(companies.id, data.companyId) : undefined,
      )).limit(1);
      if (duplicate) throw new Error("A company with that name already exists.");

      const values = {
        name: data.name,
        normalisedName: normalised,
        domain: extractDomain(data.websiteUrl) || null,
        normalisedDomain: extractDomain(data.websiteUrl) || null,
        sector: data.sector || null,
        websiteUrl: data.websiteUrl || null,
        linkedinUrl: data.linkedinUrl || null,
        fitScore: data.fitScore,
        scaleNote: data.scaleNote || null,
        researchNote: data.researchNote || null,
        updatedAt: new Date(),
      };
      let row;
      if (data.companyId) {
        [row] = await tx.update(companies).set(values).where(and(
          eq(companies.id, data.companyId),
          eq(companies.organisationId, member.organisationId),
        )).returning();
        if (!row) throw new Error("That company is not available.");
      } else {
        [row] = await tx.insert(companies).values({ ...values, organisationId: member.organisationId }).returning();
        const [pipeline] = await tx.select({ id: pipelines.id }).from(pipelines).where(and(
          eq(pipelines.organisationId, member.organisationId),
          eq(pipelines.active, true),
        )).limit(1);
        if (!pipeline) throw new Error("No active pipeline is configured.");
        const [stage] = await tx.select({ id: stages.id }).from(stages).where(and(
          eq(stages.pipelineId, pipeline.id),
          eq(stages.active, true),
        )).orderBy(stages.position).limit(1);
        if (!stage) throw new Error("No pipeline stage is configured.");
        const [opportunity] = await tx.insert(opportunities).values({
          organisationId: member.organisationId,
          pipelineId: pipeline.id,
          companyId: row.id,
          stageId: stage.id,
          offerId: await resolvePostgresOfferId(tx, member.organisationId, data.offerId, true),
          ownerId: member.id,
          title: `${row.name} research`,
          noNextActionReason: "Researching fit and the right contact",
        }).returning({ id: opportunities.id });
        opportunityId = opportunity.id;
      }
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: data.companyId ? "company.updated" : "company.created",
        entityType: "company",
        entityId: row.id,
        after: { name: row.name, opportunityId },
      });
      return {
        id: row.id,
        name: row.name,
        sector: row.sector,
        websiteUrl: row.websiteUrl,
        linkedinUrl: row.linkedinUrl,
        fitScore: row.fitScore,
        scaleNote: row.scaleNote,
        doNotContact: row.doNotContact,
        researchNote: row.researchNote,
        sourceUrls: row.sourceUrls,
      };
    });
    revalidatePath("/companies");
    revalidatePath("/pipeline");
    return { ok: true, company: saved, opportunityId };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Company could not be saved.") };
  }
}

export async function saveActivityTypeAction(input: unknown): Promise<SaveActivityTypeResult> {
  const parsed = saveActivityTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the activity type." };

  try {
    const member = await requireMember();
    if (member.role !== "admin") return { ok: false, error: "Only workspace admins can edit activity types." };
    if (member.demoMode) return { ok: false, error: "Activity types cannot be edited in the reset-on-refresh demo." };
    const data = parsed.data;

    if (member.storageMode === "sqlite") {
      const saved = updateLocalBoardSnapshot((snapshot): ActivityTypeSummary => {
        const duplicate = snapshot.activityTypes.find((item) => item.id !== data.activityTypeId && item.name.toLowerCase() === data.name.toLowerCase());
        if (duplicate) throw new Error("An activity type with that name already exists.");
        const existing = data.activityTypeId ? snapshot.activityTypes.find((item) => item.id === data.activityTypeId) : null;
        if (data.activityTypeId && !existing) throw new Error("That activity type is not available.");
        const next: ActivityTypeSummary = {
          id: existing?.id ?? crypto.randomUUID(),
          name: data.name,
          channel: data.channel,
          colour: data.colour.toUpperCase(),
          icon: existing?.icon ?? iconForChannel(data.channel),
        };
        if (existing) {
          snapshot.activityTypes = snapshot.activityTypes.map((item) => item.id === next.id ? next : item);
          for (const opportunity of snapshot.opportunities) {
            opportunity.activities = opportunity.activities.map((activity) => activity.type.id === next.id ? { ...activity, type: next } : activity);
          }
        } else {
          snapshot.activityTypes.push(next);
        }
        return next;
      });
      recordLocalAuditEvent({ actorId: member.id, action: data.activityTypeId ? "activity_type.updated" : "activity_type.created", entityType: "activity_type", entityId: saved.id, detail: { ...saved } });
      revalidatePath("/settings");
      revalidatePath("/pipeline");
      return { ok: true, activityType: saved };
    }

    const values = {
      name: data.name,
      channel: data.channel,
      colour: data.colour.toUpperCase(),
      updatedAt: new Date(),
    };
    let saved: ActivityTypeSummary;
    if (data.activityTypeId) {
      const [row] = await db.update(activityTypes).set(values).where(and(eq(activityTypes.id, data.activityTypeId), eq(activityTypes.organisationId, member.organisationId))).returning();
      if (!row) throw new Error("That activity type is not available.");
      saved = { id: row.id, name: row.name, channel: row.channel, icon: row.icon, colour: row.colour };
    } else {
      const [row] = await db.insert(activityTypes).values({ ...values, organisationId: member.organisationId, icon: iconForChannel(data.channel), builtIn: false }).returning();
      saved = { id: row.id, name: row.name, channel: row.channel, icon: row.icon, colour: row.colour };
    }
    await db.insert(auditEvents).values({
      organisationId: member.organisationId,
      actorId: member.id,
      action: data.activityTypeId ? "activity_type.updated" : "activity_type.created",
      entityType: "activity_type",
      entityId: saved.id,
      after: saved,
    });
    revalidatePath("/settings");
    revalidatePath("/pipeline");
    return { ok: true, activityType: saved };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Activity type could not be saved.") };
  }
}

function iconForChannel(channel: ActivityTypeSummary["channel"]) {
  return ({ linkedin: "MessageSquare", email: "Mail", phone: "Phone", meeting: "CalendarCheck", physical: "Package", note: "NotebookPen" } as const)[channel];
}

export async function createOpportunityAction(input: unknown): Promise<CreateActionResult> {
  const parsed = createOpportunitySchema.safeParse(normaliseOpportunityUrls(input));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the opportunity details." };
  }

  const member = await requireMember();
  if (member.storageMode === "sqlite") {
    const opportunityId = crypto.randomUUID();
    let companyId = crypto.randomUUID();
    updateLocalBoardSnapshot((snapshot) => {
      const input = parsed.data;
      const stage = snapshot.stages.find((item) => item.id === input.stageId);
      if (!stage) throw new Error("That pipeline stage is not available.");
      const domain = extractDomain(input.websiteUrl);
      const companyName = normaliseName(input.companyName);
      const existingCompany = snapshot.opportunities.find((item) =>
        (domain && extractDomain(item.company.websiteUrl ?? "") === domain) ||
        normaliseName(item.company.name) === companyName,
      )?.company;
      companyId = existingCompany?.id ?? companyId;
      const company = existingCompany ?? {
        id: companyId,
        name: input.companyName,
        sector: input.sector || null,
        websiteUrl: input.websiteUrl || null,
        linkedinUrl: input.companyLinkedinUrl || null,
        fitScore: input.fitScore,
        scaleNote: null,
        doNotContact: false,
      };
      const owner = snapshot.users.find((item) => item.id === input.ownerId) ?? null;
      const offer = chooseLocalOffer(snapshot, input.offerId, false);
      const contactId = input.contactName ? crypto.randomUUID() : null;
      snapshot.opportunities.unshift({
        id: opportunityId,
        stageId: input.stageId,
        position: Math.max(0, ...snapshot.opportunities.filter((item) => item.stageId === input.stageId).map((item) => item.position)) + 1000,
        offer,
        company,
        title: input.title,
        priority: input.priority,
        temperature: input.temperature,
        expectedValue: input.expectedValue,
        probability: input.probability,
        expectedCloseDate: input.expectedCloseDate?.toISOString() ?? null,
        owner,
        outreachAngle: input.outreachAngle || null,
        lastActivityAt: null,
        nextActionAt: input.nextActionAt?.toISOString() ?? null,
        noNextActionReason: null,
        contacts: contactId ? [{
          id: contactId,
          name: input.contactName,
          title: input.contactTitle || null,
          email: input.contactEmail || null,
          phone: input.contactPhone || null,
          linkedinUrl: input.contactLinkedinUrl || null,
          primary: true,
          preferredChannel: null,
          doNotContact: false,
        }] : [],
        activities: [],
        tasks: input.nextActionTitle && input.nextActionAt ? [{
          id: crypto.randomUUID(),
          title: input.nextActionTitle,
          dueAt: input.nextActionAt.toISOString(),
          status: "open",
          owner: owner ?? snapshot.users.find((item) => item.id === member.id) ?? null,
          contactId,
        }] : [],
        recentChannels: [],
        aiSuggestions: [],
      });
    });
    recordLocalAuditEvent({ actorId: member.id, action: "opportunity.created", entityType: "opportunity", entityId: opportunityId, detail: { companyId, stageId: parsed.data.stageId } });
    revalidatePath("/pipeline");
    revalidatePath("/companies");
    return { ok: true, opportunityId, companyId };
  }
  if (member.demoMode) {
    return {
      ok: true,
      opportunityId: crypto.randomUUID(),
      companyId: crypto.randomUUID(),
    };
  }

  try {
    const created = await db.transaction(async (tx) => {
      const input = parsed.data;
      const [target] = await tx
        .select({ stageId: stages.id, pipelineId: pipelines.id })
        .from(stages)
        .innerJoin(pipelines, eq(stages.pipelineId, pipelines.id))
        .where(
          and(
            eq(stages.id, input.stageId),
            eq(stages.active, true),
            eq(pipelines.active, true),
            eq(pipelines.organisationId, member.organisationId),
          ),
        )
        .limit(1);
      if (!target) throw new Error("That pipeline stage is not available.");
      const offerId = await resolvePostgresOfferId(tx, member.organisationId, input.offerId, false);

      if (input.ownerId) {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, input.ownerId),
              eq(users.organisationId, member.organisationId),
              eq(users.active, true),
            ),
          )
          .limit(1);
        if (!owner) throw new Error("That opportunity owner is not available.");
      }

      const normalisedCompanyName = normaliseName(input.companyName);
      const normalisedDomain = extractDomain(input.websiteUrl);
      const companyMatch = normalisedDomain
        ? or(
            eq(companies.normalisedDomain, normalisedDomain),
            eq(companies.normalisedName, normalisedCompanyName),
          )
        : eq(companies.normalisedName, normalisedCompanyName);
      let [company] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.organisationId, member.organisationId), companyMatch))
        .limit(1);

      if (!company) {
        [company] = await tx
          .insert(companies)
          .values({
            organisationId: member.organisationId,
            name: input.companyName,
            normalisedName: normalisedCompanyName,
            domain: normalisedDomain,
            normalisedDomain,
            websiteUrl: input.websiteUrl || null,
            linkedinUrl: input.companyLinkedinUrl || null,
            sector: input.sector || null,
            fitScore: input.fitScore,
          })
          .returning();
      }

      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          organisationId: member.organisationId,
          pipelineId: target.pipelineId,
          companyId: company.id,
          stageId: target.stageId,
          offerId,
          ownerId: input.ownerId,
          title: input.title,
          priority: input.priority,
          temperature: input.temperature,
          value: input.expectedValue === null ? null : String(input.expectedValue),
          probability: input.probability,
          expectedCloseDate: input.expectedCloseDate,
          outreachAngle: input.outreachAngle || null,
          nextActionAt: input.nextActionAt,
        })
        .returning({ id: opportunities.id });

      await tx.insert(stageHistory).values({
        opportunityId: opportunity.id,
        fromStageId: null,
        toStageId: target.stageId,
        movedById: member.id,
      });

      let contactId: string | null = null;
      if (input.contactName) {
        const [contact] = await tx
          .insert(contacts)
          .values({
            organisationId: member.organisationId,
            companyId: company.id,
            name: input.contactName,
            normalisedName: normaliseName(input.contactName),
            title: input.contactTitle || null,
            email: input.contactEmail || null,
            phone: input.contactPhone || null,
            linkedinUrl: input.contactLinkedinUrl || null,
            source: "manual",
          })
          .returning({ id: contacts.id });
        contactId = contact.id;
        await tx.insert(opportunityContacts).values({
          opportunityId: opportunity.id,
          contactId,
          role: input.contactTitle || null,
          primary: true,
        });
      }

      if (input.nextActionTitle && input.nextActionAt) {
        await tx.insert(tasks).values({
          organisationId: member.organisationId,
          opportunityId: opportunity.id,
          contactId,
          ownerId: input.ownerId ?? member.id,
          title: input.nextActionTitle,
          dueAt: input.nextActionAt,
          source: "opportunity_create",
        });
      }

      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "opportunity.created",
        entityType: "opportunity",
        entityId: opportunity.id,
        after: { companyId: company.id, stageId: target.stageId, ownerId: input.ownerId, offerId },
      });

      return { opportunityId: opportunity.id, companyId: company.id };
    });

    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    revalidatePath("/companies");
    revalidatePath("/search");
    revalidatePath("/reports");
    return { ok: true, ...created };
  } catch (error) {
    return {
      ok: false,
      error: publicActionError(error, "Opportunity could not be created."),
    };
  }
}

function normaliseOpportunityUrls(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    websiteUrl: typeof record.websiteUrl === "string" ? normaliseHttpUrlInput(record.websiteUrl) : record.websiteUrl,
    companyLinkedinUrl: typeof record.companyLinkedinUrl === "string" ? normaliseHttpUrlInput(record.companyLinkedinUrl) : record.companyLinkedinUrl,
    contactLinkedinUrl: typeof record.contactLinkedinUrl === "string" ? normaliseHttpUrlInput(record.contactLinkedinUrl) : record.contactLinkedinUrl,
  };
}

function normaliseCompanyUrls(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    websiteUrl: typeof record.websiteUrl === "string" ? normaliseHttpUrlInput(record.websiteUrl) : record.websiteUrl,
    linkedinUrl: typeof record.linkedinUrl === "string" ? normaliseHttpUrlInput(record.linkedinUrl) : record.linkedinUrl,
  };
}

export async function saveContactAction(input: unknown): Promise<SaveContactResult> {
  const parsed = saveContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the contact details." };
  }

  const member = await requireMember();
  if (member.storageMode === "sqlite") {
    const saved = updateLocalBoardSnapshot((snapshot): ContactSummary => {
      const opportunity = snapshot.opportunities.find((item) => item.id === parsed.data.opportunityId);
      if (!opportunity) throw new Error("Opportunity not found.");
      const existing = parsed.data.contactId
        ? opportunity.contacts.find((item) => item.id === parsed.data.contactId)
        : null;
      if (parsed.data.contactId && !existing) throw new Error("Contact not found on this opportunity.");
      if (parsed.data.primary) {
        opportunity.contacts = opportunity.contacts.map((item) => ({ ...item, primary: false }));
      }
      const nextContact: ContactSummary = {
        id: existing?.id ?? crypto.randomUUID(),
        name: parsed.data.name,
        title: parsed.data.title || null,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        linkedinUrl: parsed.data.linkedinUrl || null,
        preferredChannel: parsed.data.preferredChannel,
        doNotContact: parsed.data.doNotContact,
        primary: parsed.data.primary || (!existing && opportunity.contacts.length === 0),
        sourceUrls: existing?.sourceUrls ?? [],
      };
      opportunity.contacts = existing
        ? opportunity.contacts.map((item) => item.id === existing.id ? nextContact : item)
        : [...opportunity.contacts, nextContact];
      return nextContact;
    });
    recordLocalAuditEvent({ actorId: member.id, action: parsed.data.contactId ? "contact.updated" : "contact.created", entityType: "contact", entityId: saved.id, detail: { opportunityId: parsed.data.opportunityId } });
    revalidatePath("/pipeline");
    revalidatePath("/companies");
    return { ok: true, contact: saved };
  }
  if (member.demoMode) {
    return {
      ok: true,
      contact: {
        id: parsed.data.contactId ?? crypto.randomUUID(),
        name: parsed.data.name,
        title: parsed.data.title || null,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        linkedinUrl: parsed.data.linkedinUrl || null,
        preferredChannel: parsed.data.preferredChannel,
        doNotContact: parsed.data.doNotContact,
        primary: parsed.data.primary,
        sourceUrls: [],
      },
    };
  }

  try {
    const saved = await db.transaction(async (tx) => {
      const [opportunity] = await tx.select().from(opportunities).where(and(
        eq(opportunities.id, parsed.data.opportunityId),
        eq(opportunities.organisationId, member.organisationId),
      )).limit(1);
      if (!opportunity) throw new Error("Opportunity not found.");

      let contactId = parsed.data.contactId ?? null;
      if (contactId) {
        const [linked] = await tx.select({ id: contacts.id }).from(opportunityContacts)
          .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
          .where(and(eq(opportunityContacts.opportunityId, opportunity.id), eq(contacts.id, contactId), eq(contacts.organisationId, member.organisationId)))
          .limit(1);
        if (!linked) throw new Error("Contact not found on this opportunity.");
        await tx.update(contacts).set({
          name: parsed.data.name,
          normalisedName: normaliseName(parsed.data.name),
          title: parsed.data.title || null,
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          linkedinUrl: parsed.data.linkedinUrl || null,
          preferredChannel: parsed.data.preferredChannel,
          doNotContact: parsed.data.doNotContact,
          updatedAt: new Date(),
        }).where(eq(contacts.id, contactId));
      } else {
        const [created] = await tx.insert(contacts).values({
          organisationId: member.organisationId,
          companyId: opportunity.companyId,
          name: parsed.data.name,
          normalisedName: normaliseName(parsed.data.name),
          title: parsed.data.title || null,
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          linkedinUrl: parsed.data.linkedinUrl || null,
          preferredChannel: parsed.data.preferredChannel,
          doNotContact: parsed.data.doNotContact,
          source: "manual",
        }).returning({ id: contacts.id });
        contactId = created.id;
        await tx.insert(opportunityContacts).values({ opportunityId: opportunity.id, contactId, primary: false });
      }
      if (parsed.data.primary) {
        await tx.update(opportunityContacts).set({ primary: false }).where(eq(opportunityContacts.opportunityId, opportunity.id));
      }
      await tx.update(opportunityContacts).set({ primary: parsed.data.primary }).where(and(
        eq(opportunityContacts.opportunityId, opportunity.id),
        eq(opportunityContacts.contactId, contactId),
      ));
      const [row] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
      if (!row) throw new Error("Contact could not be saved.");
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: parsed.data.contactId ? "contact.updated" : "contact.created",
        entityType: "contact",
        entityId: contactId,
        after: { opportunityId: opportunity.id, primary: parsed.data.primary },
      });
      return {
        id: row.id,
        name: row.name,
        title: row.title,
        email: row.email,
        phone: row.phone,
        linkedinUrl: row.linkedinUrl,
        preferredChannel: row.preferredChannel,
        doNotContact: row.doNotContact,
        primary: parsed.data.primary,
        sourceUrls: row.sourceUrls,
      } satisfies ContactSummary;
    });
    revalidatePath("/pipeline");
    revalidatePath("/companies");
    revalidatePath("/search");
    return { ok: true, contact: saved };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Contact could not be saved.") };
  }
}

export async function saveOpportunityDetailsAction(input: unknown): Promise<ActionResult> {
  const parsed = saveOpportunityDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the opportunity details." };

  try {
    const member = await requireMember();
    if (member.demoMode) return { ok: false, error: "Opportunities cannot be edited in the reset-on-refresh demo." };
    const data = parsed.data;

    if (member.storageMode === "sqlite") {
      updateLocalBoardSnapshot((snapshot) => {
        const opportunity = snapshot.opportunities.find((item) => item.id === data.opportunityId);
        if (!opportunity) throw new Error("Opportunity not found.");
        const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
        const allowUnassigned = stage?.name === "Researching" || stage?.name === "Research holding";
        const owner = data.ownerId ? snapshot.users.find((item) => item.id === data.ownerId && item.active !== false) ?? null : null;
        if (data.ownerId && !owner) throw new Error("That opportunity owner is not available.");
        opportunity.title = data.title;
        opportunity.offer = chooseLocalOffer(snapshot, data.offerId, allowUnassigned);
        opportunity.owner = owner;
        opportunity.priority = data.priority;
        opportunity.temperature = data.temperature;
        opportunity.expectedValue = data.expectedValue;
        opportunity.probability = data.probability;
        opportunity.expectedCloseDate = data.expectedCloseDate?.toISOString() ?? null;
        opportunity.outreachAngle = data.outreachAngle || null;
      });
      recordLocalAuditEvent({ actorId: member.id, action: "opportunity.updated", entityType: "opportunity", entityId: data.opportunityId, detail: { offerId: data.offerId, ownerId: data.ownerId } });
      revalidateCrmPaths();
      return { ok: true };
    }

    await db.transaction(async (tx) => {
      const [record] = await tx.select({ opportunity: opportunities, stageName: stages.name }).from(opportunities)
        .innerJoin(stages, eq(opportunities.stageId, stages.id))
        .where(and(eq(opportunities.id, data.opportunityId), eq(opportunities.organisationId, member.organisationId)))
        .limit(1);
      if (!record) throw new Error("Opportunity not found.");
      const allowUnassigned = record.stageName === "Researching" || record.stageName === "Research holding";
      const offerId = await resolvePostgresOfferId(tx, member.organisationId, data.offerId, allowUnassigned);
      if (data.ownerId) {
        const [owner] = await tx.select({ id: users.id }).from(users).where(and(
          eq(users.id, data.ownerId),
          eq(users.organisationId, member.organisationId),
          eq(users.active, true),
        )).limit(1);
        if (!owner) throw new Error("That opportunity owner is not available.");
      }
      await tx.update(opportunities).set({
        title: data.title,
        offerId,
        ownerId: data.ownerId,
        priority: data.priority,
        temperature: data.temperature,
        value: data.expectedValue === null ? null : String(data.expectedValue),
        probability: data.probability,
        expectedCloseDate: data.expectedCloseDate,
        outreachAngle: data.outreachAngle || null,
        updatedAt: new Date(),
      }).where(eq(opportunities.id, data.opportunityId));
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "opportunity.updated",
        entityType: "opportunity",
        entityId: data.opportunityId,
        before: { offerId: record.opportunity.offerId, ownerId: record.opportunity.ownerId, value: record.opportunity.value, probability: record.opportunity.probability, expectedCloseDate: record.opportunity.expectedCloseDate },
        after: { offerId, ownerId: data.ownerId, value: data.expectedValue, probability: data.probability, expectedCloseDate: data.expectedCloseDate },
      });
    });
    revalidateCrmPaths();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Opportunity could not be saved.") };
  }
}

export async function moveOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = moveOpportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That stage change is invalid." };

  const member = await requireMember();
  if (member.storageMode === "sqlite") {
    let fromStageId = "";
    updateLocalBoardSnapshot((snapshot) => {
      const opportunity = snapshot.opportunities.find((item) => item.id === parsed.data.opportunityId);
      if (!opportunity) throw new Error("Opportunity not found.");
      const targetStage = snapshot.stages.find((item) => item.id === parsed.data.toStageId);
      if (!targetStage) throw new Error("Target stage is not available.");
      if (!["Researching", "Research holding"].includes(targetStage.name) && !opportunity.offer) {
        throw new Error("Choose what you are pitching before moving this target onto the sales board.");
      }
      fromStageId = opportunity.stageId;
      opportunity.stageId = parsed.data.toStageId;
    });
    recordLocalAuditEvent({ actorId: member.id, action: "opportunity.stage_changed", entityType: "opportunity", entityId: parsed.data.opportunityId, detail: { fromStageId, toStageId: parsed.data.toStageId } });
    revalidatePath("/pipeline");
    return { ok: true };
  }
  if (member.demoMode) return { ok: true };

  try {
    await db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, parsed.data.opportunityId),
            eq(opportunities.organisationId, member.organisationId),
          ),
        )
        .limit(1);
      if (!opportunity) throw new Error("Opportunity not found.");

      const [targetStage] = await tx
        .select()
        .from(stages)
        .where(
          and(
            eq(stages.id, parsed.data.toStageId),
            eq(stages.pipelineId, opportunity.pipelineId),
            eq(stages.active, true),
          ),
        )
        .limit(1);
      if (!targetStage) throw new Error("Target stage is not available.");
      if (!["Researching", "Research holding"].includes(targetStage.name) && !opportunity.offerId) {
        throw new Error("Choose what you are pitching before moving this target onto the sales board.");
      }
      if (opportunity.stageId === targetStage.id) return;

      await tx
        .update(opportunities)
        .set({ stageId: targetStage.id, updatedAt: new Date() })
        .where(eq(opportunities.id, opportunity.id));
      await tx.insert(stageHistory).values({
        opportunityId: opportunity.id,
        fromStageId: opportunity.stageId,
        toStageId: targetStage.id,
        movedById: member.id,
      });
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "opportunity.stage_changed",
        entityType: "opportunity",
        entityId: opportunity.id,
        before: { stageId: opportunity.stageId },
        after: { stageId: targetStage.id },
      });
    });
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Stage change failed.") };
  }
}

export async function reorderOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = reorderOpportunitySchema.safeParse(input);
  if (!parsed.success || !parsed.data.orderedOpportunityIds.includes(parsed.data.opportunityId)) {
    return { ok: false, error: "That card order is invalid." };
  }

  const member = await requireMember();
  const { opportunityId, toStageId, orderedOpportunityIds } = parsed.data;
  if (member.storageMode === "sqlite") {
    let fromStageId = "";
    updateLocalBoardSnapshot((snapshot) => {
      const opportunity = snapshot.opportunities.find((item) => item.id === opportunityId);
      const targetStage = snapshot.stages.find((item) => item.id === toStageId);
      if (!opportunity || !targetStage) throw new Error("Opportunity or target stage not found.");
      if (!["Researching", "Research holding"].includes(targetStage.name) && !opportunity.offer) {
        throw new Error("Choose what you are pitching before moving this target onto the sales board.");
      }
      fromStageId = opportunity.stageId;
      const expected = snapshot.opportunities
        .filter((item) => item.stageId === toStageId && item.id !== opportunityId)
        .map((item) => item.id);
      const supplied = orderedOpportunityIds.filter((id) => id !== opportunityId);
      if (expected.length !== supplied.length || expected.some((id) => !supplied.includes(id))) {
        throw new Error("The board changed while you were dragging. Refresh and try again.");
      }
      opportunity.stageId = toStageId;
      orderedOpportunityIds.forEach((id, index) => {
        const item = snapshot.opportunities.find((candidate) => candidate.id === id);
        if (item) item.position = (index + 1) * 1000;
      });
    });
    recordLocalAuditEvent({ actorId: member.id, action: "opportunity.reordered", entityType: "opportunity", entityId: opportunityId, detail: { fromStageId, toStageId, position: orderedOpportunityIds.indexOf(opportunityId) } });
    revalidatePath("/pipeline");
    return { ok: true };
  }
  if (member.demoMode) return { ok: true };

  try {
    await db.transaction(async (tx) => {
      const [opportunity] = await tx.select().from(opportunities).where(and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organisationId, member.organisationId),
      )).limit(1);
      if (!opportunity) throw new Error("Opportunity not found.");
      const [targetStage] = await tx.select().from(stages).where(and(
        eq(stages.id, toStageId),
        eq(stages.pipelineId, opportunity.pipelineId),
        eq(stages.active, true),
      )).limit(1);
      if (!targetStage) throw new Error("Target stage is not available.");
      if (!["Researching", "Research holding"].includes(targetStage.name) && !opportunity.offerId) {
        throw new Error("Choose what you are pitching before moving this target onto the sales board.");
      }
      const currentTarget = await tx.select({ id: opportunities.id }).from(opportunities).where(and(
        eq(opportunities.organisationId, member.organisationId),
        eq(opportunities.pipelineId, opportunity.pipelineId),
        eq(opportunities.stageId, toStageId),
      ));
      const expected = currentTarget.map((item) => item.id).filter((id) => id !== opportunityId);
      const supplied = orderedOpportunityIds.filter((id) => id !== opportunityId);
      if (expected.length !== supplied.length || expected.some((id) => !supplied.includes(id))) {
        throw new Error("The board changed while you were dragging. Refresh and try again.");
      }
      for (const [index, id] of orderedOpportunityIds.entries()) {
        await tx.update(opportunities).set({
          stageId: toStageId,
          position: (index + 1) * 1000,
          updatedAt: new Date(),
        }).where(and(eq(opportunities.id, id), eq(opportunities.organisationId, member.organisationId)));
      }
      if (opportunity.stageId !== toStageId) {
        await tx.insert(stageHistory).values({ opportunityId, fromStageId: opportunity.stageId, toStageId, movedById: member.id });
      }
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "opportunity.reordered",
        entityType: "opportunity",
        entityId: opportunityId,
        before: { stageId: opportunity.stageId, position: opportunity.position },
        after: { stageId: toStageId, position: orderedOpportunityIds.indexOf(opportunityId) },
      });
    });
    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Opportunity order could not be saved.") };
  }
}

function revalidateCrmPaths() {
  for (const path of ["/pipeline", "/research", "/targets", "/companies", "/search", "/reports", "/my-work", "/playbook"]) {
    revalidatePath(path);
  }
}

export async function logActivityAction(input: unknown): Promise<ActionResult> {
  const parsed = logActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the activity details and try again." };

  const member = await requireMember();
  if (member.storageMode === "sqlite") {
    const activityId = crypto.randomUUID();
    updateLocalBoardSnapshot((snapshot) => {
      const opportunity = snapshot.opportunities.find((item) => item.id === parsed.data.opportunityId);
      if (!opportunity) throw new Error("Opportunity not found.");
      const type = snapshot.activityTypes.find((item) => item.id === parsed.data.activityTypeId);
      if (!type) throw new Error("Activity type not found.");
      const contact = opportunity.contacts.find((item) => item.id === parsed.data.contactId);
      const occurredAt = parsed.data.occurredAt.toISOString();
      opportunity.activities.unshift({
        id: activityId,
        type,
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? null,
        outcome: parsed.data.outcome || null,
        notes: parsed.data.notes || null,
        occurredAt,
        createdAt: new Date().toISOString(),
        createdBy: member.name,
      });
      opportunity.lastActivityAt = occurredAt;
      opportunity.recentChannels = [type.channel, ...opportunity.recentChannels.filter((item) => item !== type.channel)].slice(0, 4);
      if (parsed.data.nextActionTitle && parsed.data.nextActionAt) {
        opportunity.tasks.push({
          id: crypto.randomUUID(),
          title: parsed.data.nextActionTitle,
          dueAt: parsed.data.nextActionAt.toISOString(),
          status: "open",
          owner: opportunity.owner ?? snapshot.users.find((item) => item.id === member.id) ?? null,
          contactId: contact?.id ?? null,
        });
        opportunity.nextActionAt = parsed.data.nextActionAt.toISOString();
        opportunity.noNextActionReason = null;
      }
    });
    recordLocalAuditEvent({ actorId: member.id, action: "activity.created", entityType: "activity", entityId: activityId, detail: { opportunityId: parsed.data.opportunityId } });
    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    return { ok: true };
  }
  if (member.demoMode) return { ok: true };

  try {
    await db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, parsed.data.opportunityId),
            eq(opportunities.organisationId, member.organisationId),
          ),
        )
        .limit(1);
      if (!opportunity) throw new Error("Opportunity not found.");

      const [type] = await tx
        .select({ id: activityTypes.id })
        .from(activityTypes)
        .where(
          and(
            eq(activityTypes.id, parsed.data.activityTypeId),
            eq(activityTypes.organisationId, member.organisationId),
            eq(activityTypes.active, true),
          ),
        )
        .limit(1);
      if (!type) throw new Error("Activity type not found.");

      let contactId: string | null = null;
      if (parsed.data.contactId) {
        const [linkedContact] = await tx
          .select({ id: contacts.id })
          .from(opportunityContacts)
          .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
          .where(and(
            eq(opportunityContacts.opportunityId, opportunity.id),
            eq(contacts.id, parsed.data.contactId),
            eq(contacts.organisationId, member.organisationId),
          ))
          .limit(1);
        if (!linkedContact) throw new Error("Contact not found on this opportunity.");
        contactId = linkedContact.id;
      }

      const [created] = await tx
        .insert(activities)
        .values({
          organisationId: member.organisationId,
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
          contactId,
          activityTypeId: type.id,
          outcome: parsed.data.outcome || null,
          notes: parsed.data.notes || null,
          occurredAt: parsed.data.occurredAt,
          createdById: member.id,
        })
        .returning({ id: activities.id });

      let nextActionAt = opportunity.nextActionAt;
      if (parsed.data.nextActionTitle && parsed.data.nextActionAt) {
        await tx.insert(tasks).values({
          organisationId: member.organisationId,
          opportunityId: opportunity.id,
          contactId,
          ownerId: opportunity.ownerId ?? member.id,
          title: parsed.data.nextActionTitle,
          dueAt: parsed.data.nextActionAt,
          source: "activity_follow_up",
        });
        nextActionAt = parsed.data.nextActionAt;
      }

      await tx
        .update(opportunities)
        .set({
          lastActivityAt: parsed.data.occurredAt,
          nextActionAt,
          noNextActionReason: nextActionAt ? null : opportunity.noNextActionReason,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.id, opportunity.id));

      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "activity.created",
        entityType: "activity",
        entityId: created.id,
        after: { opportunityId: opportunity.id, occurredAt: parsed.data.occurredAt.toISOString() },
      });
    });
    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Activity could not be saved.") };
  }
}

export async function completeTaskAction(input: unknown): Promise<ActionResult> {
  const parsed = completeTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That task is invalid." };

  const member = await requireMember();
  if (member.storageMode === "sqlite") {
    updateLocalBoardSnapshot((snapshot) => {
      const task = snapshot.opportunities.flatMap((item) => item.tasks).find((item) => item.id === parsed.data.taskId);
      if (!task) throw new Error("Task not found.");
      task.status = "completed";
    });
    recordLocalAuditEvent({ actorId: member.id, action: "task.completed", entityType: "task", entityId: parsed.data.taskId });
    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    return { ok: true };
  }
  if (member.demoMode) return { ok: true };

  try {
    await db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.id, parsed.data.taskId), eq(tasks.organisationId, member.organisationId)),
        )
        .limit(1);
      if (!task) throw new Error("Task not found.");

      await tx
        .update(tasks)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      await tx.insert(auditEvents).values({
        organisationId: member.organisationId,
        actorId: member.id,
        action: "task.completed",
        entityType: "task",
        entityId: task.id,
        before: { status: task.status },
        after: { status: "completed" },
      });
    });
    revalidatePath("/pipeline");
    revalidatePath("/my-work");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "Task could not be completed.") };
  }
}
