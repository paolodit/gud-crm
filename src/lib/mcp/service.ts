import { and, asc, eq, ilike, max, or } from "drizzle-orm";

import { db } from "@/db";
import {
  activities,
  activityTypes,
  auditEvents,
  companies,
  contacts,
  offers,
  opportunities,
  opportunityContacts,
  pipelines,
  stageHistory,
  stages,
  tasks,
  users,
} from "@/db/schema";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { extractDomain, normaliseName } from "@/lib/domain/normalise";

export type McpActor = {
  id: string;
  name: string;
  email: string;
  organisationId: string;
  role: "admin" | "manager" | "member";
};

export type CreateOpportunityInput = {
  companyName: string;
  title: string;
  websiteUrl?: string;
  companyLinkedinUrl?: string;
  sector?: string;
  fitScore?: number | null;
  offerId?: string | null;
  offerName?: string;
  stageId?: string;
  stageName?: string;
  ownerId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  temperature?: "cold" | "warm" | "hot" | "at_risk" | "unresponsive";
  expectedValue?: number | null;
  probability?: number | null;
  expectedCloseDate?: Date | null;
  outreachAngle?: string;
  contact?: {
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
    sourceUrls?: string[];
  };
  nextAction?: { title: string; dueAt: Date };
};

export type UpdateOpportunityInput = {
  opportunityId: string;
  title?: string;
  offerId?: string | null;
  offerName?: string;
  stageId?: string;
  stageName?: string;
  ownerId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  temperature?: "cold" | "warm" | "hot" | "at_risk" | "unresponsive";
  expectedValue?: number | null;
  probability?: number | null;
  expectedCloseDate?: Date | null;
  outreachAngle?: string;
  confirmTerminalMove?: boolean;
};

export type LogActivityInput = {
  opportunityId: string;
  activityTypeId?: string;
  activityTypeName?: string;
  contactId?: string | null;
  outcome?: string | null;
  notes?: string | null;
  occurredAt: Date;
  nextAction?: { title: string; dueAt: Date };
};

export type SubmitResearchTargetInput = {
  companyName: string;
  websiteUrl?: string;
  companyLinkedinUrl?: string;
  sector?: string;
  fitScore?: number | null;
  offerId?: string | null;
  offerName?: string;
  researchSummary?: string;
  evidence?: Array<{ claim: string; url: string; observedAt?: string }>;
  sourceUrls?: string[];
  contacts?: Array<{
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
    sourceUrls?: string[];
  }>;
};

export async function getMcpActor(userId: string): Promise<McpActor | null> {
  const [member] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      organisationId: users.organisationId,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!member?.active || !member.organisationId) return null;
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    organisationId: member.organisationId,
    role: member.role,
  };
}

export async function describeWorkspace(actor: McpActor) {
  const snapshot = await getBoardSnapshot(actor.organisationId);
  return {
    edition: snapshot.edition,
    pipeline: snapshot.pipeline,
    offers: snapshot.offers.filter((offer) => offer.active).map((offer) => ({
      id: offer.id,
      name: offer.name,
      description: offer.description,
      idealCustomer: offer.idealCustomer,
      positioning: offer.positioning,
      isDefault: offer.isDefault,
    })),
    stages: snapshot.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      terminalType: stage.terminalType,
      position: stage.position,
    })),
    activityTypes: snapshot.activityTypes.map((activityType) => ({
      id: activityType.id,
      name: activityType.name,
      channel: activityType.channel,
    })),
    members: snapshot.users.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
    })),
    guardrails: [
      "Research findings must include public source URLs and must not contain guessed personal data.",
      "Use submit_research_results for targets that still need human review.",
      "Never initiate outreach through GUD; the CRM records decisions and activity.",
      "Terminal stage moves require an explicit confirmation flag.",
    ],
  };
}

export async function listOpportunities(
  actor: McpActor,
  filters: {
    query?: string;
    stageId?: string;
    stageName?: string;
    ownerId?: string;
    offerId?: string;
    needsAttention?: boolean;
    limit?: number;
  },
) {
  const snapshot = await getBoardSnapshot(actor.organisationId);
  const query = filters.query?.trim().toLowerCase();
  const stageId = filters.stageId
    ?? snapshot.stages.find((stage) => stage.name.toLowerCase() === filters.stageName?.trim().toLowerCase())?.id;
  if (filters.stageName && !stageId) {
    throw new Error("That stage name is not available. Use describe_workspace to choose a current stage.");
  }
  const now = Date.now();
  return snapshot.opportunities
    .filter((opportunity) => {
      if (query && ![
        opportunity.company.name,
        opportunity.title,
        opportunity.offer?.name,
        ...opportunity.contacts.flatMap((contact) => [contact.name, contact.title]),
      ].some((value) => value?.toLowerCase().includes(query))) return false;
      if (stageId && opportunity.stageId !== stageId) return false;
      if (filters.ownerId && opportunity.owner?.id !== filters.ownerId) return false;
      if (filters.offerId && opportunity.offer?.id !== filters.offerId) return false;
      if (filters.needsAttention) {
        const due = opportunity.nextActionAt ? new Date(opportunity.nextActionAt).getTime() : null;
        if (!(due === null || due < now || opportunity.temperature === "at_risk")) return false;
      }
      return true;
    })
    .slice(0, filters.limit ?? 50)
    .map((opportunity) => opportunityListItem(opportunity, snapshot.stages));
}

export async function getOpportunity(actor: McpActor, opportunityId: string) {
  const snapshot = await getBoardSnapshot(actor.organisationId);
  const opportunity = snapshot.opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) throw new Error("Opportunity not found in this workspace.");
  const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
  return {
    ...opportunityListItem(opportunity, snapshot.stages),
    company: opportunity.company,
    outreachAngle: opportunity.outreachAngle,
    expectedValue: opportunity.expectedValue ?? null,
    probability: opportunity.probability ?? null,
    expectedCloseDate: opportunity.expectedCloseDate ?? null,
    noNextActionReason: opportunity.noNextActionReason,
    contacts: opportunity.contacts,
    openTasks: opportunity.tasks.filter((task) => task.status === "open"),
    recentActivities: opportunity.activities.slice(0, 20),
    terminalType: stage?.terminalType ?? "open",
  };
}

export async function searchCompanies(actor: McpActor, query: string, limit = 25) {
  const needle = query.trim();
  const pattern = `%${needle.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return db.select({
    id: companies.id,
    name: companies.name,
    domain: companies.domain,
    websiteUrl: companies.websiteUrl,
    linkedinUrl: companies.linkedinUrl,
    sector: companies.sector,
    fitScore: companies.fitScore,
    researchNote: companies.researchNote,
    sourceUrls: companies.sourceUrls,
    doNotContact: companies.doNotContact,
  }).from(companies).where(and(
    eq(companies.organisationId, actor.organisationId),
    needle ? or(
      ilike(companies.name, pattern),
      ilike(companies.domain, pattern),
      ilike(companies.sector, pattern),
      ilike(companies.researchNote, pattern),
    ) : undefined,
  )).orderBy(asc(companies.name)).limit(limit);
}

export async function createOpportunity(actor: McpActor, input: CreateOpportunityInput) {
  const opportunityId = await db.transaction(async (tx) => {
    const [pipeline] = await tx.select().from(pipelines).where(and(
      eq(pipelines.organisationId, actor.organisationId),
      eq(pipelines.active, true),
    )).orderBy(asc(pipelines.createdAt)).limit(1);
    if (!pipeline) throw new Error("No active pipeline is configured.");

    const stage = await resolveStage(tx, pipeline.id, input.stageId, input.stageName, "Outreach active");
    const offerId = await resolveOffer(tx, actor.organisationId, input.offerId, input.offerName);
    if (!["Researching", "Research holding"].includes(stage.name) && !offerId) {
      throw new Error("Choose an offer before creating an active sales opportunity.");
    }
    const ownerId = await resolveOwner(tx, actor, input.ownerId);

    const normalisedCompanyName = normaliseName(input.companyName);
    const domain = extractDomain(input.websiteUrl ?? "");
    const companyCondition = domain
      ? or(eq(companies.normalisedDomain, domain), eq(companies.normalisedName, normalisedCompanyName))
      : eq(companies.normalisedName, normalisedCompanyName);
    let [company] = await tx.select().from(companies).where(and(
      eq(companies.organisationId, actor.organisationId),
      companyCondition,
    )).limit(1);
    if (!company) {
      [company] = await tx.insert(companies).values({
        organisationId: actor.organisationId,
        name: input.companyName,
        normalisedName: normalisedCompanyName,
        domain: domain || null,
        normalisedDomain: domain || null,
        websiteUrl: input.websiteUrl || null,
        linkedinUrl: input.companyLinkedinUrl || null,
        sector: input.sector || null,
        fitScore: input.fitScore ?? null,
        importMetadata: { source: "mcp" },
      }).returning();
    }

    const [existing] = await tx.select({ id: opportunities.id }).from(opportunities).where(and(
      eq(opportunities.organisationId, actor.organisationId),
      eq(opportunities.companyId, company.id),
      eq(opportunities.title, input.title),
      offerId ? eq(opportunities.offerId, offerId) : undefined,
    )).limit(1);
    if (existing) throw new Error(`A matching opportunity already exists (${existing.id}).`);

    const [{ highestPosition }] = await tx.select({ highestPosition: max(opportunities.position) })
      .from(opportunities)
      .where(and(eq(opportunities.pipelineId, pipeline.id), eq(opportunities.stageId, stage.id)));
    const [opportunity] = await tx.insert(opportunities).values({
      organisationId: actor.organisationId,
      pipelineId: pipeline.id,
      companyId: company.id,
      stageId: stage.id,
      position: (highestPosition ?? 0) + 1000,
      offerId,
      ownerId,
      title: input.title,
      priority: input.priority ?? "medium",
      temperature: input.temperature ?? "cold",
      value: input.expectedValue == null ? null : String(input.expectedValue),
      probability: input.probability ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      outreachAngle: input.outreachAngle || null,
      nextActionAt: input.nextAction?.dueAt ?? null,
      noNextActionReason: input.nextAction ? null : "Created through MCP; human next-action review required",
      importMetadata: { source: "mcp" },
    }).returning({ id: opportunities.id });

    await tx.insert(stageHistory).values({
      opportunityId: opportunity.id,
      fromStageId: null,
      toStageId: stage.id,
      movedById: actor.id,
    });

    let contactId: string | null = null;
    if (input.contact) {
      const matchingContacts = await tx.select().from(contacts).where(and(
        eq(contacts.organisationId, actor.organisationId),
        or(
          input.contact.email ? eq(contacts.email, input.contact.email) : undefined,
          input.contact.linkedinUrl ? eq(contacts.linkedinUrl, input.contact.linkedinUrl) : undefined,
          and(
            eq(contacts.companyId, company.id),
            eq(contacts.normalisedName, normaliseName(input.contact.name)),
          ),
        ),
      )).limit(2);
      const existingContact = matchingContacts[0];
      if (existingContact && existingContact.companyId !== company.id) {
        throw new Error("That contact email or LinkedIn profile already belongs to another company. Review the existing record instead of moving it automatically.");
      }
      const [contact] = existingContact
        ? await tx.update(contacts).set({
          title: input.contact.title || existingContact.title,
          email: input.contact.email || existingContact.email,
          phone: input.contact.phone || existingContact.phone,
          linkedinUrl: input.contact.linkedinUrl || existingContact.linkedinUrl,
          sourceUrls: uniqueUrls(existingContact.sourceUrls, input.contact.sourceUrls),
          updatedAt: new Date(),
        }).where(eq(contacts.id, existingContact.id)).returning({ id: contacts.id })
        : await tx.insert(contacts).values({
          organisationId: actor.organisationId,
          companyId: company.id,
          name: input.contact.name,
          normalisedName: normaliseName(input.contact.name),
          title: input.contact.title || null,
          email: input.contact.email || null,
          phone: input.contact.phone || null,
          linkedinUrl: input.contact.linkedinUrl || null,
          sourceUrls: input.contact.sourceUrls ?? [],
          source: "mcp",
          importMetadata: { source: "mcp" },
        }).returning({ id: contacts.id });
      contactId = contact.id;
      await tx.insert(opportunityContacts).values({
        opportunityId: opportunity.id,
        contactId,
        primary: true,
      });
    }

    if (input.nextAction) {
      await tx.insert(tasks).values({
        organisationId: actor.organisationId,
        opportunityId: opportunity.id,
        contactId,
        ownerId,
        title: input.nextAction.title,
        dueAt: input.nextAction.dueAt,
        source: "mcp",
      });
    }

    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.opportunity.created",
      entityType: "opportunity",
      entityId: opportunity.id,
      after: { companyId: company.id, stageId: stage.id, offerId, ownerId },
    });
    return opportunity.id;
  });
  return getOpportunity(actor, opportunityId);
}

export async function updateOpportunity(actor: McpActor, input: UpdateOpportunityInput) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, input.opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Opportunity not found in this workspace.");

    const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.temperature !== undefined) patch.temperature = input.temperature;
    if (input.expectedValue !== undefined) patch.value = input.expectedValue === null ? null : String(input.expectedValue);
    if (input.probability !== undefined) patch.probability = input.probability;
    if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
    if (input.outreachAngle !== undefined) patch.outreachAngle = input.outreachAngle || null;
    if (input.ownerId !== undefined) patch.ownerId = await resolveOwner(tx, actor, input.ownerId);
    if (input.offerId !== undefined || input.offerName !== undefined) {
      patch.offerId = await resolveOffer(tx, actor.organisationId, input.offerId, input.offerName);
    }

    let targetStage: typeof stages.$inferSelect | null = null;
    if (input.stageId || input.stageName) {
      targetStage = await resolveStage(tx, current.pipelineId, input.stageId, input.stageName);
      if (!["Researching", "Research holding"].includes(targetStage.name) && (patch.offerId ?? current.offerId) === null) {
        throw new Error("Choose an offer before moving this target onto the active sales board.");
      }
      if (targetStage.terminalType === "won" || targetStage.terminalType === "lost") {
        if (!input.confirmTerminalMove) {
          throw new Error(`Moving to ${targetStage.name} is consequential. Retry with confirmTerminalMove=true after confirming with the user.`);
        }
      }
      patch.stageId = targetStage.id;
    }

    await tx.update(opportunities).set(patch).where(eq(opportunities.id, current.id));
    if (targetStage && targetStage.id !== current.stageId) {
      await tx.insert(stageHistory).values({
        opportunityId: current.id,
        fromStageId: current.stageId,
        toStageId: targetStage.id,
        movedById: actor.id,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.opportunity.updated",
      entityType: "opportunity",
      entityId: current.id,
      before: auditOpportunity(current),
      after: auditOpportunity({ ...current, ...patch }),
    });
  });
  return getOpportunity(actor, input.opportunityId);
}

export async function setNextAction(
  actor: McpActor,
  input: { opportunityId: string; title: string; dueAt: Date; contactId?: string | null },
) {
  const taskId = await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, input.opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!opportunity) throw new Error("Opportunity not found in this workspace.");
    if (input.contactId) await assertOpportunityContact(tx, opportunity.id, input.contactId);
    const [task] = await tx.insert(tasks).values({
      organisationId: actor.organisationId,
      opportunityId: opportunity.id,
      contactId: input.contactId || null,
      ownerId: opportunity.ownerId ?? actor.id,
      title: input.title,
      dueAt: input.dueAt,
      source: "mcp",
    }).returning({ id: tasks.id });
    await tx.update(opportunities).set({
      nextActionAt: input.dueAt,
      noNextActionReason: null,
      updatedAt: new Date(),
    }).where(eq(opportunities.id, opportunity.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.next_action.created",
      entityType: "task",
      entityId: task.id,
      after: { opportunityId: opportunity.id, title: input.title, dueAt: input.dueAt.toISOString() },
    });
    return task.id;
  });
  return { taskId, opportunity: await getOpportunity(actor, input.opportunityId) };
}

export async function logActivity(actor: McpActor, input: LogActivityInput) {
  const activityId = await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, input.opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!opportunity) throw new Error("Opportunity not found in this workspace.");
    const activityType = await resolveActivityType(tx, actor.organisationId, input.activityTypeId, input.activityTypeName);
    if (input.contactId) await assertOpportunityContact(tx, opportunity.id, input.contactId);
    const [activity] = await tx.insert(activities).values({
      organisationId: actor.organisationId,
      opportunityId: opportunity.id,
      companyId: opportunity.companyId,
      contactId: input.contactId || null,
      activityTypeId: activityType.id,
      outcome: input.outcome || null,
      notes: input.notes || null,
      metadata: { source: "mcp" },
      occurredAt: input.occurredAt,
      createdById: actor.id,
    }).returning({ id: activities.id });
    const opportunityPatch: Partial<typeof opportunities.$inferInsert> = {
      lastActivityAt: input.occurredAt,
      updatedAt: new Date(),
    };
    if (input.nextAction) {
      await tx.insert(tasks).values({
        organisationId: actor.organisationId,
        opportunityId: opportunity.id,
        contactId: input.contactId || null,
        ownerId: opportunity.ownerId ?? actor.id,
        title: input.nextAction.title,
        dueAt: input.nextAction.dueAt,
        source: "mcp",
      });
      opportunityPatch.nextActionAt = input.nextAction.dueAt;
      opportunityPatch.noNextActionReason = null;
    }
    await tx.update(opportunities).set(opportunityPatch).where(eq(opportunities.id, opportunity.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.activity.logged",
      entityType: "activity",
      entityId: activity.id,
      after: { opportunityId: opportunity.id, activityTypeId: activityType.id, outcome: input.outcome || null },
    });
    return activity.id;
  });
  return { activityId, opportunity: await getOpportunity(actor, input.opportunityId) };
}

export async function enrichContactEmail(
  actor: McpActor,
  input: { opportunityId: string; contactId: string },
) {
  const [
    { findWorkEmailFreeMax, providerLabel },
    { getFreeMaxRuntimeConfiguration },
    { getFreeMaxStatus },
  ] = await Promise.all([
    import("@/lib/enrichment/freemax"),
    import("@/lib/enrichment/config"),
    import("@/lib/enrichment/usage"),
  ]);
  const [record] = await db.select({
    company: companies,
    contact: contacts,
  }).from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .innerJoin(opportunityContacts, eq(opportunityContacts.opportunityId, opportunities.id))
    .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
    .where(and(
      eq(opportunities.id, input.opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
      eq(contacts.id, input.contactId),
    )).limit(1);
  if (!record) throw new Error("Contact not found on this opportunity.");
  if (record.company.doNotContact || record.contact.doNotContact) throw new Error("This record is marked do not contact.");
  if (record.contact.email) {
    return { email: record.contact.email, score: null, provider: "Existing record" };
  }
  const domain = extractDomain(record.company.websiteUrl ?? "");
  if (!domain) throw new Error("Add the company website before looking up a work email.");
  const [status, configuration] = await Promise.all([
    getFreeMaxStatus(actor.organisationId, "postgres"),
    getFreeMaxRuntimeConfiguration(actor.organisationId, "postgres"),
  ]);
  const result = await findWorkEmailFreeMax(
    { domain, fullName: record.contact.name },
    status,
    configuration.keys,
  );
  if (!result.found) throw new Error(result.message);
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({
      email: result.email,
      preferredChannel: record.contact.preferredChannel ?? "email",
      sourceUrls: uniqueUrls(record.contact.sourceUrls, result.sourceUrls),
      updatedAt: new Date(),
    }).where(eq(contacts.id, record.contact.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.contact.enriched",
      entityType: "contact",
      entityId: record.contact.id,
      after: { provider: result.provider, score: result.score, attempts: result.attempts },
    });
  });
  return { email: result.email, score: result.score, provider: providerLabel(result.provider) };
}

export async function submitResearchResults(actor: McpActor, input: SubmitResearchTargetInput) {
  const opportunityId = await db.transaction(async (tx) => {
    const [pipeline] = await tx.select().from(pipelines).where(and(
      eq(pipelines.organisationId, actor.organisationId),
      eq(pipelines.active, true),
    )).orderBy(asc(pipelines.createdAt)).limit(1);
    if (!pipeline) throw new Error("No active pipeline is configured.");
    const researchStage = await resolveStage(tx, pipeline.id, undefined, "Researching");
    const offerId = await resolveOffer(tx, actor.organisationId, input.offerId, input.offerName);
    const domain = extractDomain(input.websiteUrl ?? "");
    const normalisedCompanyName = normaliseName(input.companyName);
    const companyCondition = domain
      ? or(eq(companies.normalisedDomain, domain), eq(companies.normalisedName, normalisedCompanyName))
      : eq(companies.normalisedName, normalisedCompanyName);
    let [company] = await tx.select().from(companies).where(and(
      eq(companies.organisationId, actor.organisationId),
      companyCondition,
    )).limit(1);
    const evidenceUrls = input.evidence?.map((item) => item.url) ?? [];
    const researchNote = [
      input.researchSummary?.trim(),
      input.evidence?.length
        ? input.evidence.map((item) => `- ${item.claim}${item.observedAt ? ` (${item.observedAt})` : ""}`).join("\n")
        : "",
    ].filter(Boolean).join("\n\n");
    if (company) {
      [company] = await tx.update(companies).set({
        websiteUrl: input.websiteUrl || company.websiteUrl,
        domain: domain || company.domain,
        normalisedDomain: domain || company.normalisedDomain,
        linkedinUrl: input.companyLinkedinUrl || company.linkedinUrl,
        sector: input.sector || company.sector,
        fitScore: input.fitScore ?? company.fitScore,
        researchNote: mergeText(company.researchNote, researchNote),
        sourceUrls: uniqueUrls(company.sourceUrls, input.sourceUrls, evidenceUrls),
        updatedAt: new Date(),
      }).where(eq(companies.id, company.id)).returning();
    } else {
      [company] = await tx.insert(companies).values({
        organisationId: actor.organisationId,
        name: input.companyName,
        normalisedName: normalisedCompanyName,
        domain: domain || null,
        normalisedDomain: domain || null,
        websiteUrl: input.websiteUrl || null,
        linkedinUrl: input.companyLinkedinUrl || null,
        sector: input.sector || null,
        fitScore: input.fitScore ?? null,
        researchNote: researchNote || null,
        sourceUrls: uniqueUrls(input.sourceUrls, evidenceUrls),
        importMetadata: { source: "mcp_research" },
      }).returning();
    }

    const existingOpportunities = await tx.select().from(opportunities).where(and(
      eq(opportunities.organisationId, actor.organisationId),
      eq(opportunities.pipelineId, pipeline.id),
      eq(opportunities.companyId, company.id),
    ));
    let opportunity = existingOpportunities.find((item) => offerId ? item.offerId === offerId : item.offerId === null);
    if (!opportunity) {
      const [{ highestPosition }] = await tx.select({ highestPosition: max(opportunities.position) })
        .from(opportunities)
        .where(and(eq(opportunities.pipelineId, pipeline.id), eq(opportunities.stageId, researchStage.id)));
      [opportunity] = await tx.insert(opportunities).values({
        organisationId: actor.organisationId,
        pipelineId: pipeline.id,
        companyId: company.id,
        stageId: researchStage.id,
        position: (highestPosition ?? 0) + 1000,
        offerId,
        ownerId: actor.id,
        title: `${company.name} research`,
        priority: input.fitScore === 5 ? "high" : input.fitScore && input.fitScore >= 3 ? "medium" : "low",
        temperature: "cold",
        noNextActionReason: "Research submitted through MCP; review before promotion",
        importMetadata: { source: "mcp_research" },
      }).returning();
      await tx.insert(stageHistory).values({
        opportunityId: opportunity.id,
        fromStageId: null,
        toStageId: researchStage.id,
        movedById: actor.id,
      });
    } else if (opportunity.stageId === researchStage.id) {
      [opportunity] = await tx.update(opportunities).set({
        noNextActionReason: "Research updated through MCP; review before promotion",
        updatedAt: new Date(),
      }).where(eq(opportunities.id, opportunity.id)).returning();
    }

    for (const incoming of input.contacts ?? []) {
      const possibleContacts = await tx.select().from(contacts).where(and(
        eq(contacts.organisationId, actor.organisationId),
        or(
          incoming.email ? eq(contacts.email, incoming.email) : undefined,
          incoming.linkedinUrl ? eq(contacts.linkedinUrl, incoming.linkedinUrl) : undefined,
          and(
            eq(contacts.companyId, company.id),
            eq(contacts.normalisedName, normaliseName(incoming.name)),
          ),
        ),
      ));
      let contact = possibleContacts[0];
      if (contact && contact.companyId !== company.id) {
        throw new Error(`Contact ${incoming.name} already belongs to another company. Review that record before changing its relationship.`);
      }
      if (contact) {
        [contact] = await tx.update(contacts).set({
          title: incoming.title || contact.title,
          email: incoming.email || contact.email,
          phone: incoming.phone || contact.phone,
          linkedinUrl: incoming.linkedinUrl || contact.linkedinUrl,
          sourceUrls: uniqueUrls(contact.sourceUrls, incoming.sourceUrls),
          updatedAt: new Date(),
        }).where(eq(contacts.id, contact.id)).returning();
      } else {
        [contact] = await tx.insert(contacts).values({
          organisationId: actor.organisationId,
          companyId: company.id,
          name: incoming.name,
          normalisedName: normaliseName(incoming.name),
          title: incoming.title || null,
          email: incoming.email || null,
          phone: incoming.phone || null,
          linkedinUrl: incoming.linkedinUrl || null,
          sourceUrls: incoming.sourceUrls ?? [],
          preferredChannel: incoming.email ? "email" : incoming.phone ? "phone" : incoming.linkedinUrl ? "linkedin" : null,
          source: "mcp_research",
          importMetadata: { source: "mcp_research" },
        }).returning();
      }
      await tx.insert(opportunityContacts).values({
        opportunityId: opportunity.id,
        contactId: contact.id,
        primary: false,
      }).onConflictDoNothing();
    }

    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.research.submitted",
      entityType: "opportunity",
      entityId: opportunity.id,
      after: {
        companyId: company.id,
        offerId,
        evidenceCount: input.evidence?.length ?? 0,
        contactCount: input.contacts?.length ?? 0,
      },
    });
    return opportunity.id;
  });
  return getOpportunity(actor, opportunityId);
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolveStage(
  tx: Transaction,
  pipelineId: string,
  stageId?: string,
  stageName?: string,
  fallbackName?: string,
) {
  const stageRows = await tx.select().from(stages).where(and(
    eq(stages.pipelineId, pipelineId),
    eq(stages.active, true),
  )).orderBy(asc(stages.position));
  const resolved = stageId
    ? stageRows.find((stage) => stage.id === stageId)
    : stageName
      ? stageRows.find((stage) => stage.name.toLowerCase() === stageName.trim().toLowerCase())
      : fallbackName
        ? stageRows.find((stage) => stage.name === fallbackName) ?? stageRows.find((stage) => stage.terminalType === "open")
        : null;
  if (!resolved) throw new Error("Choose a valid pipeline stage from describe_workspace.");
  return resolved;
}

async function resolveOffer(
  tx: Transaction,
  organisationId: string,
  offerId?: string | null,
  offerName?: string,
) {
  const offerRows = await tx.select().from(offers).where(and(
    eq(offers.organisationId, organisationId),
    eq(offers.active, true),
  )).orderBy(asc(offers.position));
  if (offerId === null) return null;
  if (offerId) {
    const resolved = offerRows.find((offer) => offer.id === offerId);
    if (!resolved) throw new Error("Offer not found in this workspace.");
    return resolved.id;
  }
  if (offerName) {
    const resolved = offerRows.find((offer) => normaliseName(offer.name) === normaliseName(offerName));
    if (!resolved) throw new Error("Offer not found in this workspace.");
    return resolved.id;
  }
  if (offerRows.length === 1) return offerRows[0].id;
  const defaultOffer = offerRows.find((offer) => offer.isDefault);
  if (defaultOffer && offerRows.length === 1) return defaultOffer.id;
  return null;
}

async function resolveOwner(tx: Transaction, actor: McpActor, ownerId?: string | null) {
  if (ownerId === null) return null;
  const requestedId = ownerId ?? actor.id;
  const [owner] = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.id, requestedId),
    eq(users.organisationId, actor.organisationId),
    eq(users.active, true),
  )).limit(1);
  if (!owner) throw new Error("Owner not found in this workspace.");
  return owner.id;
}

async function resolveActivityType(
  tx: Transaction,
  organisationId: string,
  activityTypeId?: string,
  activityTypeName?: string,
) {
  const [activityType] = await tx.select().from(activityTypes).where(and(
    eq(activityTypes.organisationId, organisationId),
    eq(activityTypes.active, true),
    activityTypeId
      ? eq(activityTypes.id, activityTypeId)
      : activityTypeName
        ? eq(activityTypes.name, activityTypeName)
        : undefined,
  )).limit(1);
  if (!activityType) throw new Error("Choose a valid activity type from describe_workspace.");
  return activityType;
}

async function assertOpportunityContact(tx: Transaction, opportunityId: string, contactId: string) {
  const [link] = await tx.select({ contactId: opportunityContacts.contactId }).from(opportunityContacts).where(and(
    eq(opportunityContacts.opportunityId, opportunityId),
    eq(opportunityContacts.contactId, contactId),
  )).limit(1);
  if (!link) throw new Error("That contact is not linked to this opportunity.");
}

function opportunityListItem(
  opportunity: Awaited<ReturnType<typeof getBoardSnapshot>>["opportunities"][number],
  stageRows: Awaited<ReturnType<typeof getBoardSnapshot>>["stages"],
) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    company: { id: opportunity.company.id, name: opportunity.company.name },
    stage: stageRows.find((stage) => stage.id === opportunity.stageId) ?? null,
    offer: opportunity.offer ? { id: opportunity.offer.id, name: opportunity.offer.name } : null,
    owner: opportunity.owner ? { id: opportunity.owner.id, name: opportunity.owner.name } : null,
    priority: opportunity.priority,
    temperature: opportunity.temperature,
    nextActionAt: opportunity.nextActionAt,
    lastActivityAt: opportunity.lastActivityAt,
    contactCount: opportunity.contacts.length,
  };
}

function auditOpportunity(opportunity: Partial<typeof opportunities.$inferSelect>) {
  return {
    title: opportunity.title,
    stageId: opportunity.stageId,
    offerId: opportunity.offerId,
    ownerId: opportunity.ownerId,
    priority: opportunity.priority,
    temperature: opportunity.temperature,
    value: opportunity.value,
    probability: opportunity.probability,
    expectedCloseDate: opportunity.expectedCloseDate?.toISOString() ?? null,
  };
}

function uniqueUrls(...collections: Array<string[] | undefined>) {
  return [...new Set(collections.flatMap((items) => items ?? []))];
}

function mergeText(existing?: string | null, incoming?: string | null) {
  if (!incoming?.trim()) return existing ?? null;
  if (!existing?.trim()) return incoming.trim();
  if (existing.includes(incoming.trim())) return existing;
  return `${existing.trim()}\n\n${incoming.trim()}`;
}
