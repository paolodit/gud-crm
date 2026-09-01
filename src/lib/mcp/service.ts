import { and, asc, eq, ilike, isNull, max, ne, or } from "drizzle-orm";

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
import { isResearchStage } from "@/lib/data/board-selectors";
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

export type UpdateCompanyInput = {
  companyId: string;
  name?: string;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  sector?: string | null;
  fitScore?: number | null;
  scaleNote?: string | null;
  researchNoteAppend?: string;
  sourceUrls?: string[];
  doNotContact?: boolean;
  confirmRemoveDoNotContact?: boolean;
};

export type SaveContactInput = {
  opportunityId: string;
  contactId?: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  preferredChannel?: "linkedin" | "email" | "phone" | "meeting" | "physical" | "note" | null;
  doNotContact?: boolean;
  confirmRemoveDoNotContact?: boolean;
  primary?: boolean;
  sourceUrls?: string[];
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
    includeArchived?: boolean;
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
      if (!filters.includeArchived && (opportunity.archivedAt || opportunity.company.archivedAt)) return false;
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

export async function searchCompanies(actor: McpActor, query: string, limit = 25, includeArchived = false) {
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
    archivedAt: companies.archivedAt,
  }).from(companies).where(and(
    eq(companies.organisationId, actor.organisationId),
    includeArchived ? undefined : isNull(companies.archivedAt),
    needle ? or(
      ilike(companies.name, pattern),
      ilike(companies.domain, pattern),
      ilike(companies.sector, pattern),
      ilike(companies.researchNote, pattern),
    ) : undefined,
  )).orderBy(asc(companies.name)).limit(limit);
}

export async function getSalesBrief(
  actor: McpActor,
  options: { scope?: "mine" | "team"; ownerId?: string; horizonDays?: number; limit?: number },
) {
  const snapshot = await getBoardSnapshot(actor.organisationId);
  const generatedAt = new Date(snapshot.generatedAt);
  const horizonAt = new Date(generatedAt.getTime() + (options.horizonDays ?? 7) * 86_400_000);
  const scope = options.scope ?? "mine";
  const ownerId = options.ownerId ?? (scope === "mine" ? actor.id : null);
  const owner = ownerId ? snapshot.users.find((member) => member.id === ownerId) : null;
  if (ownerId && !owner) throw new Error("Owner not found in this workspace.");

  const stageById = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const active = snapshot.opportunities.filter((opportunity) => {
    if (opportunity.archivedAt || opportunity.company.archivedAt) return false;
    if (ownerId && opportunity.owner?.id !== ownerId) return false;
    const stage = stageById.get(opportunity.stageId);
    return Boolean(stage && stage.terminalType === "open" && !isResearchStage(stage));
  });

  const stageBreakdown = snapshot.stages
    .filter((stage) => stage.terminalType === "open" && !isResearchStage(stage))
    .map((stage) => {
      const records = active.filter((opportunity) => opportunity.stageId === stage.id);
      return {
        stageId: stage.id,
        stageName: stage.name,
        count: records.length,
        value: records.reduce((sum, opportunity) => sum + (opportunity.expectedValue ?? 0), 0),
        weightedValue: Math.round(records.reduce((sum, opportunity) => sum + ((opportunity.expectedValue ?? 0) * (opportunity.probability ?? 0) / 100), 0)),
      };
    });

  const allAttentionItems = active.map((opportunity) => {
    const dueAt = opportunity.nextActionAt ? new Date(opportunity.nextActionAt) : null;
    const reasons: string[] = [];
    if (opportunity.temperature === "at_risk") reasons.push("at risk");
    if (opportunity.temperature === "unresponsive") reasons.push("unresponsive");
    if (!dueAt) reasons.push("no next action");
    else if (dueAt < generatedAt) reasons.push("next action overdue");
    if (!reasons.length) return null;
    const nextTask = opportunity.tasks
      .filter((task) => task.status === "open")
      .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())[0];
    return {
      ...salesBriefOpportunity(opportunity, stageById.get(opportunity.stageId)?.name ?? "Unknown stage"),
      reasons,
      nextAction: nextTask ? { id: nextTask.id, title: nextTask.title, dueAt: nextTask.dueAt } : null,
      attentionOrder: dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.attentionOrder - right.attentionOrder);
  const needsAttention = allAttentionItems
    .slice(0, options.limit ?? 10)
    .map(({ attentionOrder, ...item }) => {
      void attentionOrder;
      return item;
    });

  const allUpcomingActions = active.flatMap((opportunity) => opportunity.tasks
    .filter((task) => task.status === "open")
    .filter((task) => {
      const dueAt = new Date(task.dueAt);
      return dueAt >= generatedAt && dueAt <= horizonAt;
    })
    .map((task) => ({
      ...salesBriefOpportunity(opportunity, stageById.get(opportunity.stageId)?.name ?? "Unknown stage"),
      taskId: task.id,
      action: task.title,
      dueAt: task.dueAt,
    })))
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  const upcomingActions = allUpcomingActions.slice(0, options.limit ?? 10);

  const pipelineValue = active.reduce((sum, opportunity) => sum + (opportunity.expectedValue ?? 0), 0);
  const weightedPipelineValue = Math.round(active.reduce((sum, opportunity) => sum + ((opportunity.expectedValue ?? 0) * (opportunity.probability ?? 0) / 100), 0));
  return {
    generatedAt: generatedAt.toISOString(),
    scope: owner ? "owner" as const : "team" as const,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    horizonDays: options.horizonDays ?? 7,
    totals: {
      activeOpportunities: active.length,
      pipelineValue,
      weightedPipelineValue,
      needsAttention: allAttentionItems.length,
      upcomingActions: allUpcomingActions.length,
    },
    stageBreakdown,
    needsAttention,
    upcomingActions,
    suggestedStart: needsAttention[0]
      ? `Review ${needsAttention[0].company.name}: ${needsAttention[0].reasons.join(" and ")}.`
      : upcomingActions[0]
        ? `Prepare ${upcomingActions[0].action} for ${upcomingActions[0].company.name}.`
        : "No urgent action is recorded. Review the pipeline before creating new work.",
  };
}

export async function updateCompany(actor: McpActor, input: UpdateCompanyInput) {
  if (![
    input.name,
    input.websiteUrl,
    input.linkedinUrl,
    input.sector,
    input.fitScore,
    input.scaleNote,
    input.researchNoteAppend,
    input.sourceUrls,
    input.doNotContact,
  ].some((value) => value !== undefined)) {
    throw new Error("Provide at least one organisation field to update.");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(companies).where(and(
      eq(companies.id, input.companyId),
      eq(companies.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Organisation not found in this workspace.");
    if (current.archivedAt) throw new Error("Restore this organisation before updating it.");
    if (current.doNotContact && input.doNotContact === false && !input.confirmRemoveDoNotContact) {
      throw new Error("Removing do-not-contact protection is consequential. Retry with confirmRemoveDoNotContact=true after explicit user confirmation.");
    }

    const patch: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const normalisedName = normaliseName(input.name);
      const [duplicate] = await tx.select({ id: companies.id }).from(companies).where(and(
        eq(companies.organisationId, actor.organisationId),
        eq(companies.normalisedName, normalisedName),
        ne(companies.id, current.id),
      )).limit(1);
      if (duplicate) throw new Error("Another organisation already uses that name.");
      patch.name = input.name;
      patch.normalisedName = normalisedName;
    }
    if (input.websiteUrl !== undefined) {
      const domain = extractDomain(input.websiteUrl ?? "");
      if (domain) {
        const [duplicate] = await tx.select({ id: companies.id }).from(companies).where(and(
          eq(companies.organisationId, actor.organisationId),
          eq(companies.normalisedDomain, domain),
          ne(companies.id, current.id),
        )).limit(1);
        if (duplicate) throw new Error("Another organisation already uses that website domain.");
      }
      patch.websiteUrl = input.websiteUrl || null;
      patch.domain = domain || null;
      patch.normalisedDomain = domain || null;
    }
    if (input.linkedinUrl !== undefined) patch.linkedinUrl = input.linkedinUrl || null;
    if (input.sector !== undefined) patch.sector = input.sector || null;
    if (input.fitScore !== undefined) patch.fitScore = input.fitScore;
    if (input.scaleNote !== undefined) patch.scaleNote = input.scaleNote || null;
    if (input.researchNoteAppend !== undefined) {
      patch.researchNote = mergeText(current.researchNote, input.researchNoteAppend);
    }
    if (input.sourceUrls !== undefined) patch.sourceUrls = uniqueUrls(current.sourceUrls, input.sourceUrls);
    if (input.doNotContact !== undefined) patch.doNotContact = input.doNotContact;

    const [saved] = await tx.update(companies).set(patch).where(and(
      eq(companies.id, current.id),
      eq(companies.organisationId, actor.organisationId),
    )).returning();
    if (!saved) throw new Error("Organisation could not be updated.");
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.company.updated",
      entityType: "company",
      entityId: saved.id,
      before: auditCompany(current),
      after: auditCompany(saved),
    });
    return companyResult(saved);
  });
}

export async function saveContact(actor: McpActor, input: SaveContactInput) {
  await db.transaction(async (tx) => {
    const [record] = await tx.select({
      opportunity: opportunities,
      company: companies,
    }).from(opportunities)
      .innerJoin(companies, eq(opportunities.companyId, companies.id))
      .where(and(
        eq(opportunities.id, input.opportunityId),
        eq(opportunities.organisationId, actor.organisationId),
      )).limit(1);
    if (!record) throw new Error("Opportunity not found in this workspace.");
    if (record.opportunity.archivedAt || record.company.archivedAt) {
      throw new Error("Restore this record before changing its contacts.");
    }

    let current: typeof contacts.$inferSelect | undefined;
    if (input.contactId) {
      [current] = await tx.select({ contact: contacts }).from(opportunityContacts)
        .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
        .where(and(
          eq(opportunityContacts.opportunityId, record.opportunity.id),
          eq(contacts.id, input.contactId),
          eq(contacts.organisationId, actor.organisationId),
        )).limit(1).then((rows) => rows.map((row) => row.contact));
      if (!current) throw new Error("Contact not found on this opportunity.");
    } else {
      const matchingContacts = await tx.select().from(contacts).where(and(
        eq(contacts.organisationId, actor.organisationId),
        or(
          input.email ? eq(contacts.email, input.email) : undefined,
          input.linkedinUrl ? eq(contacts.linkedinUrl, input.linkedinUrl) : undefined,
          and(
            eq(contacts.companyId, record.company.id),
            eq(contacts.normalisedName, normaliseName(input.name)),
          ),
        ),
      )).limit(2);
      current = matchingContacts[0];
      if (current && current.companyId !== record.company.id) {
        throw new Error("That email or LinkedIn profile belongs to a contact at another organisation. Review the existing record instead of moving it automatically.");
      }
    }
    if (current?.doNotContact && input.doNotContact === false && !input.confirmRemoveDoNotContact) {
      throw new Error("Removing do-not-contact protection is consequential. Retry with confirmRemoveDoNotContact=true after explicit user confirmation.");
    }
    if (input.email || input.linkedinUrl) {
      const [duplicate] = await tx.select({ id: contacts.id }).from(contacts).where(and(
        eq(contacts.organisationId, actor.organisationId),
        current ? ne(contacts.id, current.id) : undefined,
        or(
          input.email ? eq(contacts.email, input.email) : undefined,
          input.linkedinUrl ? eq(contacts.linkedinUrl, input.linkedinUrl) : undefined,
        ),
      )).limit(1);
      if (duplicate) throw new Error("Another contact already uses that email address or LinkedIn profile.");
    }

    let saved: typeof contacts.$inferSelect;
    if (current) {
      [saved] = await tx.update(contacts).set({
        name: input.name,
        normalisedName: normaliseName(input.name),
        title: input.title === undefined ? current.title : input.title || null,
        email: input.email === undefined ? current.email : input.email || null,
        phone: input.phone === undefined ? current.phone : input.phone || null,
        linkedinUrl: input.linkedinUrl === undefined ? current.linkedinUrl : input.linkedinUrl || null,
        preferredChannel: input.preferredChannel === undefined ? current.preferredChannel : input.preferredChannel,
        doNotContact: input.doNotContact ?? current.doNotContact,
        sourceUrls: uniqueUrls(current.sourceUrls, input.sourceUrls),
        updatedAt: new Date(),
      }).where(and(
        eq(contacts.id, current.id),
        eq(contacts.organisationId, actor.organisationId),
      )).returning();
    } else {
      [saved] = await tx.insert(contacts).values({
        organisationId: actor.organisationId,
        companyId: record.company.id,
        name: input.name,
        normalisedName: normaliseName(input.name),
        title: input.title || null,
        email: input.email || null,
        phone: input.phone || null,
        linkedinUrl: input.linkedinUrl || null,
        preferredChannel: input.preferredChannel ?? null,
        doNotContact: input.doNotContact ?? false,
        sourceUrls: input.sourceUrls ?? [],
        source: "mcp",
        importMetadata: { source: "mcp" },
      }).returning();
    }

    const [existingLink] = await tx.select({ primary: opportunityContacts.primary }).from(opportunityContacts).where(and(
      eq(opportunityContacts.opportunityId, record.opportunity.id),
      eq(opportunityContacts.contactId, saved.id),
    )).limit(1);
    const linksBefore = await tx.select({ contactId: opportunityContacts.contactId }).from(opportunityContacts)
      .where(eq(opportunityContacts.opportunityId, record.opportunity.id));
    const hasAnotherContact = linksBefore.some((link) => link.contactId !== saved.id);
    const shouldBePrimary = hasAnotherContact
      ? input.primary ?? existingLink?.primary ?? false
      : true;
    if (!existingLink) {
      await tx.insert(opportunityContacts).values({
        opportunityId: record.opportunity.id,
        contactId: saved.id,
        primary: shouldBePrimary,
      });
    }
    if (shouldBePrimary) {
      await tx.update(opportunityContacts).set({ primary: false })
        .where(eq(opportunityContacts.opportunityId, record.opportunity.id));
    }
    if (existingLink || shouldBePrimary) {
      await tx.update(opportunityContacts).set({ primary: shouldBePrimary }).where(and(
        eq(opportunityContacts.opportunityId, record.opportunity.id),
        eq(opportunityContacts.contactId, saved.id),
      ));
    }
    await ensurePrimaryContact(tx, record.opportunity.id);
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: current ? "mcp.contact.updated" : "mcp.contact.created",
      entityType: "contact",
      entityId: saved.id,
      before: current ? auditContact(current) : undefined,
      after: { ...auditContact(saved), opportunityId: record.opportunity.id, primary: shouldBePrimary },
    });
  });
  return getOpportunity(actor, input.opportunityId);
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
  if (![
    input.title,
    input.offerId,
    input.offerName,
    input.stageId,
    input.stageName,
    input.ownerId,
    input.priority,
    input.temperature,
    input.expectedValue,
    input.probability,
    input.expectedCloseDate,
    input.outreachAngle,
  ].some((value) => value !== undefined)) {
    throw new Error("Provide at least one opportunity field to update.");
  }
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
      if (targetStage.id !== current.stageId) {
        const [{ highestPosition }] = await tx.select({ highestPosition: max(opportunities.position) })
          .from(opportunities)
          .where(and(eq(opportunities.pipelineId, current.pipelineId), eq(opportunities.stageId, targetStage.id)));
        patch.position = (highestPosition ?? 0) + 1000;
      }
      if (targetStage.terminalType === "won" || targetStage.terminalType === "lost") {
        patch.closedAt = current.closedAt ?? new Date();
      } else {
        patch.closedAt = null;
        patch.closedReason = null;
      }
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

export async function archiveOpportunity(actor: McpActor, opportunityId: string, confirmArchive: boolean) {
  if (!confirmArchive) {
    throw new Error("Archiving removes the opportunity from active views. Retry with confirmArchive=true after explicit user confirmation.");
  }
  const archivedAt = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Opportunity not found in this workspace.");
    if (current.archivedAt) throw new Error("Restore this opportunity before updating it.");
    if (current.archivedAt) return current.archivedAt;
    const timestamp = new Date();
    await tx.update(opportunities).set({ archivedAt: timestamp, updatedAt: timestamp }).where(and(
      eq(opportunities.id, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.opportunity.archived",
      entityType: "opportunity",
      entityId: current.id,
      before: { archivedAt: null },
      after: { archivedAt: timestamp.toISOString(), companyId: current.companyId },
    });
    return timestamp;
  });
  return { opportunityId, archivedAt: archivedAt.toISOString() };
}

export async function restoreOpportunity(actor: McpActor, opportunityId: string) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Opportunity not found in this workspace.");
    if (!current.archivedAt) {
      await tx.update(companies).set({ archivedAt: null, updatedAt: new Date() }).where(and(
        eq(companies.id, current.companyId),
        eq(companies.organisationId, actor.organisationId),
      ));
      return;
    }
    await tx.update(opportunities).set({ archivedAt: null, updatedAt: new Date() }).where(and(
      eq(opportunities.id, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    await tx.update(companies).set({ archivedAt: null, updatedAt: new Date() }).where(and(
      eq(companies.id, current.companyId),
      eq(companies.organisationId, actor.organisationId),
    ));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.opportunity.restored",
      entityType: "opportunity",
      entityId: current.id,
      before: { archivedAt: current.archivedAt.toISOString() },
      after: { archivedAt: null, companyId: current.companyId },
    });
  });
  return getOpportunity(actor, opportunityId);
}

export async function archiveCompany(actor: McpActor, companyId: string, confirmArchive: boolean) {
  if (!confirmArchive) {
    throw new Error("Archiving an organisation also archives all of its opportunities. Retry with confirmArchive=true after explicit user confirmation.");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(companies).where(and(
      eq(companies.id, companyId),
      eq(companies.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Organisation not found in this workspace.");
    const linkedOpportunities = await tx.select({ id: opportunities.id }).from(opportunities).where(and(
      eq(opportunities.companyId, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    if (current.archivedAt) {
      return { companyId, archivedAt: current.archivedAt.toISOString(), affectedOpportunities: linkedOpportunities.length };
    }
    const timestamp = new Date();
    await tx.update(companies).set({ archivedAt: timestamp, updatedAt: timestamp }).where(and(
      eq(companies.id, current.id),
      eq(companies.organisationId, actor.organisationId),
    ));
    await tx.update(opportunities).set({ archivedAt: timestamp, updatedAt: timestamp }).where(and(
      eq(opportunities.companyId, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.company.archived",
      entityType: "company",
      entityId: current.id,
      before: { archivedAt: null },
      after: { archivedAt: timestamp.toISOString(), affectedOpportunities: linkedOpportunities.length },
    });
    return { companyId, archivedAt: timestamp.toISOString(), affectedOpportunities: linkedOpportunities.length };
  });
}

export async function restoreCompany(actor: McpActor, companyId: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(companies).where(and(
      eq(companies.id, companyId),
      eq(companies.organisationId, actor.organisationId),
    )).limit(1);
    if (!current) throw new Error("Organisation not found in this workspace.");
    const linkedOpportunities = await tx.select({ id: opportunities.id }).from(opportunities).where(and(
      eq(opportunities.companyId, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    if (!current.archivedAt) {
      return { company: companyResult(current), restoredOpportunities: 0 };
    }
    const timestamp = new Date();
    await tx.update(companies).set({ archivedAt: null, updatedAt: timestamp }).where(and(
      eq(companies.id, current.id),
      eq(companies.organisationId, actor.organisationId),
    ));
    await tx.update(opportunities).set({ archivedAt: null, updatedAt: timestamp }).where(and(
      eq(opportunities.companyId, current.id),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.company.restored",
      entityType: "company",
      entityId: current.id,
      before: { archivedAt: current.archivedAt.toISOString() },
      after: { archivedAt: null, restoredOpportunities: linkedOpportunities.length },
    });
    return {
      company: companyResult({ ...current, archivedAt: null, updatedAt: timestamp }),
      restoredOpportunities: linkedOpportunities.length,
    };
  });
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
    if (opportunity.archivedAt) throw new Error("Restore this opportunity before setting a next action.");
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

export async function completeTask(actor: McpActor, opportunityId: string, taskId: string) {
  await db.transaction(async (tx) => {
    const [task] = await tx.select({
      task: tasks,
      opportunity: opportunities,
    }).from(tasks)
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .where(and(
        eq(tasks.id, taskId),
        eq(tasks.opportunityId, opportunityId),
        eq(tasks.organisationId, actor.organisationId),
        eq(opportunities.organisationId, actor.organisationId),
      )).limit(1);
    if (!task) throw new Error("Next action not found on this opportunity.");
    if (task.opportunity.archivedAt) throw new Error("Restore this opportunity before completing a next action.");
    if (task.task.status === "completed") return;
    if (task.task.status !== "open") throw new Error("Only an open next action can be completed.");

    const completedAt = new Date();
    await tx.update(tasks).set({ status: "completed", completedAt, updatedAt: completedAt }).where(and(
      eq(tasks.id, task.task.id),
      eq(tasks.organisationId, actor.organisationId),
    ));
    const [nextOpenTask] = await tx.select({ dueAt: tasks.dueAt }).from(tasks).where(and(
      eq(tasks.opportunityId, opportunityId),
      eq(tasks.organisationId, actor.organisationId),
      eq(tasks.status, "open"),
    )).orderBy(asc(tasks.dueAt)).limit(1);
    await tx.update(opportunities).set({
      nextActionAt: nextOpenTask?.dueAt ?? null,
      noNextActionReason: nextOpenTask ? null : "Previous action completed through MCP; add the next move",
      updatedAt: completedAt,
    }).where(and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    ));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: "mcp.task.completed",
      entityType: "task",
      entityId: task.task.id,
      before: { status: task.task.status, completedAt: task.task.completedAt?.toISOString() ?? null },
      after: { status: "completed", completedAt: completedAt.toISOString(), opportunityId },
    });
  });
  return getOpportunity(actor, opportunityId);
}

export async function logActivity(actor: McpActor, input: LogActivityInput) {
  const activityId = await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, input.opportunityId),
      eq(opportunities.organisationId, actor.organisationId),
    )).limit(1);
    if (!opportunity) throw new Error("Opportunity not found in this workspace.");
    if (opportunity.archivedAt) throw new Error("Restore this opportunity before logging activity.");
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
    opportunityArchivedAt: opportunities.archivedAt,
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
  if (record.company.archivedAt || record.opportunityArchivedAt) throw new Error("Restore this record before enriching a contact.");
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

async function ensurePrimaryContact(tx: Transaction, opportunityId: string) {
  const links = await tx.select({
    contactId: opportunityContacts.contactId,
    primary: opportunityContacts.primary,
  }).from(opportunityContacts).where(eq(opportunityContacts.opportunityId, opportunityId))
    .orderBy(asc(opportunityContacts.createdAt));
  if (!links.length || links.some((link) => link.primary)) return;
  await tx.update(opportunityContacts).set({ primary: true }).where(and(
    eq(opportunityContacts.opportunityId, opportunityId),
    eq(opportunityContacts.contactId, links[0].contactId),
  ));
}

function opportunityListItem(
  opportunity: Awaited<ReturnType<typeof getBoardSnapshot>>["opportunities"][number],
  stageRows: Awaited<ReturnType<typeof getBoardSnapshot>>["stages"],
) {
  return {
    id: opportunity.id,
    recordPath: `/pipeline?opportunity=${opportunity.id}`,
    title: opportunity.title,
    company: { id: opportunity.company.id, name: opportunity.company.name },
    stage: stageRows.find((stage) => stage.id === opportunity.stageId) ?? null,
    offer: opportunity.offer ? { id: opportunity.offer.id, name: opportunity.offer.name } : null,
    owner: opportunity.owner ? { id: opportunity.owner.id, name: opportunity.owner.name } : null,
    priority: opportunity.priority,
    temperature: opportunity.temperature,
    archivedAt: opportunity.archivedAt,
    companyArchivedAt: opportunity.company.archivedAt,
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

function salesBriefOpportunity(
  opportunity: Awaited<ReturnType<typeof getBoardSnapshot>>["opportunities"][number],
  stageName: string,
) {
  return {
    opportunityId: opportunity.id,
    title: opportunity.title,
    company: { id: opportunity.company.id, name: opportunity.company.name },
    stage: { id: opportunity.stageId, name: stageName },
    offer: opportunity.offer ? { id: opportunity.offer.id, name: opportunity.offer.name } : null,
    priority: opportunity.priority,
    temperature: opportunity.temperature,
    expectedValue: opportunity.expectedValue ?? null,
    probability: opportunity.probability ?? null,
  };
}

function auditCompany(company: Partial<typeof companies.$inferSelect>) {
  return {
    name: company.name,
    websiteUrl: company.websiteUrl,
    linkedinUrl: company.linkedinUrl,
    sector: company.sector,
    fitScore: company.fitScore,
    scaleNote: company.scaleNote,
    researchNote: company.researchNote,
    sourceUrls: company.sourceUrls,
    doNotContact: company.doNotContact,
    archivedAt: company.archivedAt?.toISOString() ?? null,
  };
}

function auditContact(contact: Partial<typeof contacts.$inferSelect>) {
  return {
    name: contact.name,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    linkedinUrl: contact.linkedinUrl,
    preferredChannel: contact.preferredChannel,
    doNotContact: contact.doNotContact,
    sourceUrls: contact.sourceUrls,
  };
}

function companyResult(company: typeof companies.$inferSelect) {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinUrl: company.linkedinUrl,
    sector: company.sector,
    fitScore: company.fitScore,
    scaleNote: company.scaleNote,
    researchNote: company.researchNote,
    sourceUrls: company.sourceUrls,
    doNotContact: company.doNotContact,
    archivedAt: company.archivedAt,
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
