import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  activities,
  activityTypes,
  aiFeedback,
  aiSuggestions,
  companies,
  contacts,
  opportunityContacts,
  opportunities,
  organisations,
  offers,
  pipelines,
  researchThemes,
  stages,
  tasks,
  users,
} from "@/db/schema";
import { aiCoachModeSchema, aiCoachOutputSchema, aiFeedbackRatingSchema } from "@/lib/ai/schema";
import { demoBoardForEdition } from "@/lib/demo-data";
import { getLocalBoardSnapshot } from "@/lib/data/local-store";
import type {
  ActivitySummary,
  BoardSnapshot,
  ContactSummary,
  OpportunitySummary,
  TaskSummary,
} from "@/lib/domain/types";
import { env } from "@/lib/env";
import { getEdition, normaliseEditionKey } from "@/lib/editions";

const iso = (value: Date | null) => value?.toISOString() ?? null;

export async function getBoardSnapshot(organisationId: string): Promise<BoardSnapshot> {
  if (env.demoMode) return demoBoardForEdition(env.defaultEdition);
  if (env.sqliteMode) return getLocalBoardSnapshot();

  const [[organisation], [pipeline]] = await Promise.all([db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1), db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(eq(pipelines.organisationId, organisationId), eq(pipelines.active, true)))
    .orderBy(asc(pipelines.createdAt))
    .limit(1)]);

  if (!pipeline) {
    throw new Error("No active pipeline is configured for this organisation.");
  }

  const [stageRows, offerRows, opportunityRows, activityTypeRows, userRows, researchThemeRows] = await Promise.all([
    db
      .select()
      .from(stages)
      .where(and(eq(stages.pipelineId, pipeline.id), eq(stages.active, true)))
      .orderBy(asc(stages.position)),
    db
      .select()
      .from(offers)
      .where(eq(offers.organisationId, organisationId))
      .orderBy(asc(offers.position), asc(offers.name)),
    db
      .select({
        opportunity: opportunities,
        company: companies,
        offer: offers,
        ownerId: users.id,
        ownerName: users.name,
        ownerEmail: users.email,
        ownerImage: users.image,
      })
      .from(opportunities)
      .innerJoin(companies, eq(opportunities.companyId, companies.id))
      .leftJoin(offers, eq(opportunities.offerId, offers.id))
      .leftJoin(users, eq(opportunities.ownerId, users.id))
      .where(
        and(
          eq(opportunities.organisationId, organisationId),
          eq(opportunities.pipelineId, pipeline.id),
        ),
      )
      .orderBy(asc(opportunities.position), desc(opportunities.updatedAt)),
    db
      .select()
      .from(activityTypes)
      .where(and(eq(activityTypes.organisationId, organisationId), eq(activityTypes.active, true)))
      .orderBy(asc(activityTypes.name)),
    db
      .select({ id: users.id, name: users.name, email: users.email, image: users.image, role: users.role, active: users.active })
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.active, true)))
      .orderBy(asc(users.name)),
    db.select().from(researchThemes).where(eq(researchThemes.organisationId, organisationId)).orderBy(asc(researchThemes.position), desc(researchThemes.updatedAt)),
  ]);

  const opportunityIds = opportunityRows.map((row) => row.opportunity.id);
  const emptyRelated = opportunityIds.length === 0;

  const [contactRows, activityRows, taskRows, suggestionRows] = emptyRelated
    ? [[], [], [], []]
    : await Promise.all([
        db
          .select({
            opportunityId: opportunityContacts.opportunityId,
            primary: opportunityContacts.primary,
            contact: contacts,
          })
          .from(opportunityContacts)
          .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
          .where(inArray(opportunityContacts.opportunityId, opportunityIds)),
        db
          .select({
            activity: activities,
            type: activityTypes,
            contactName: contacts.name,
            createdByName: users.name,
          })
          .from(activities)
          .innerJoin(activityTypes, eq(activities.activityTypeId, activityTypes.id))
          .leftJoin(contacts, eq(activities.contactId, contacts.id))
          .leftJoin(users, eq(activities.createdById, users.id))
          .where(inArray(activities.opportunityId, opportunityIds))
          .orderBy(desc(activities.occurredAt)),
        db
          .select({
            task: tasks,
            ownerId: users.id,
            ownerName: users.name,
            ownerEmail: users.email,
            ownerImage: users.image,
          })
          .from(tasks)
          .leftJoin(users, eq(tasks.ownerId, users.id))
          .where(inArray(tasks.opportunityId, opportunityIds))
          .orderBy(asc(tasks.dueAt)),
        db
          .select()
          .from(aiSuggestions)
          .where(inArray(aiSuggestions.opportunityId, opportunityIds))
          .orderBy(desc(aiSuggestions.generatedAt)),
      ]);

  const suggestionIds = suggestionRows.map((row) => row.id);
  const feedbackRows = suggestionIds.length
    ? await db.select().from(aiFeedback).where(inArray(aiFeedback.suggestionId, suggestionIds))
    : [];
  const feedbackBySuggestion = new Map(feedbackRows.map((row) => [row.suggestionId, row.rating]));

  const contactsByOpportunity = new Map<string, ContactSummary[]>();
  for (const row of contactRows) {
    const list = contactsByOpportunity.get(row.opportunityId) ?? [];
    list.push({
      id: row.contact.id,
      name: row.contact.name,
      title: row.contact.title,
      email: row.contact.email,
      phone: row.contact.phone,
      linkedinUrl: row.contact.linkedinUrl,
      primary: row.primary,
      preferredChannel: row.contact.preferredChannel,
      doNotContact: row.contact.doNotContact,
      sourceUrls: row.contact.sourceUrls,
    });
    contactsByOpportunity.set(row.opportunityId, list);
  }

  const activitiesByOpportunity = new Map<string, ActivitySummary[]>();
  for (const row of activityRows) {
    const list = activitiesByOpportunity.get(row.activity.opportunityId) ?? [];
    list.push({
      id: row.activity.id,
      type: {
        id: row.type.id,
        name: row.type.name,
        channel: row.type.channel,
        icon: row.type.icon,
        colour: row.type.colour,
      },
      contactId: row.activity.contactId,
      contactName: row.contactName,
      outcome: row.activity.outcome,
      notes: row.activity.notes,
      occurredAt: row.activity.occurredAt.toISOString(),
      createdAt: row.activity.createdAt.toISOString(),
      createdBy: row.createdByName ?? "Former user",
    });
    activitiesByOpportunity.set(row.activity.opportunityId, list);
  }

  const tasksByOpportunity = new Map<string, TaskSummary[]>();
  for (const row of taskRows) {
    const list = tasksByOpportunity.get(row.task.opportunityId) ?? [];
    list.push({
      id: row.task.id,
      title: row.task.title,
      dueAt: row.task.dueAt.toISOString(),
      status: row.task.status,
      contactId: row.task.contactId,
      owner: row.ownerId
        ? {
            id: row.ownerId,
            name: row.ownerName ?? "Unknown",
            email: row.ownerEmail,
            image: row.ownerImage,
          }
        : null,
    });
    tasksByOpportunity.set(row.task.opportunityId, list);
  }

  const mappedOpportunities: OpportunitySummary[] = opportunityRows.map((row) => {
    const relatedActivities = activitiesByOpportunity.get(row.opportunity.id) ?? [];
    return {
      id: row.opportunity.id,
      isExample: row.opportunity.importMetadata?.demoExample === true,
      stageId: row.opportunity.stageId,
      position: row.opportunity.position,
      offer: row.offer ? {
        id: row.offer.id,
        name: row.offer.name,
        colour: row.offer.colour,
        description: row.offer.description,
        idealCustomer: row.offer.idealCustomer,
        positioning: row.offer.positioning,
        isDefault: row.offer.isDefault,
        active: row.offer.active,
        position: row.offer.position,
      } : null,
      company: {
        id: row.company.id,
        name: row.company.name,
        sector: row.company.sector,
        websiteUrl: row.company.websiteUrl,
        linkedinUrl: row.company.linkedinUrl,
        fitScore: row.company.fitScore,
        scaleNote: row.company.scaleNote,
        doNotContact: row.company.doNotContact,
        researchNote: row.company.researchNote,
        sourceUrls: row.company.sourceUrls,
      },
      title: row.opportunity.title,
      priority: row.opportunity.priority,
      temperature: row.opportunity.temperature,
      expectedValue: row.opportunity.value === null ? null : Number(row.opportunity.value),
      probability: row.opportunity.probability,
      expectedCloseDate: iso(row.opportunity.expectedCloseDate),
      owner: row.ownerId
        ? {
            id: row.ownerId,
            name: row.ownerName ?? "Unknown",
            email: row.ownerEmail,
            image: row.ownerImage,
          }
        : null,
      outreachAngle: row.opportunity.outreachAngle,
      lastActivityAt: iso(row.opportunity.lastActivityAt),
      nextActionAt: iso(row.opportunity.nextActionAt),
      noNextActionReason: row.opportunity.noNextActionReason,
      contacts: contactsByOpportunity.get(row.opportunity.id) ?? [],
      activities: relatedActivities,
      tasks: tasksByOpportunity.get(row.opportunity.id) ?? [],
      recentChannels: [...new Set(relatedActivities.slice(0, 4).map((item) => item.type.channel))],
      aiSuggestions: suggestionRows
        .filter((item) => item.opportunityId === row.opportunity.id)
        .flatMap((item) => {
          const output = aiCoachOutputSchema.safeParse(item.output);
          const suggestionType = aiCoachModeSchema.safeParse(item.suggestionType);
          const feedbackRating = aiFeedbackRatingSchema.safeParse(feedbackBySuggestion.get(item.id));
          if (!output.success || !suggestionType.success) return [];
          return [{
            id: item.id,
            opportunityId: item.opportunityId,
            suggestionType: suggestionType.data,
            output: output.data,
            contextReferences: item.contextReferences,
            provider: item.provider,
            model: item.model,
            promptVersion: item.promptVersion,
            inputTokens: item.inputTokens,
            outputTokens: item.outputTokens,
            generatedAt: item.generatedAt.toISOString(),
            feedbackRating: feedbackRating.success ? feedbackRating.data : null,
          }];
        })
        .slice(0, 12),
    };
  });

  return {
    edition: organisation ? normaliseEditionKey(organisation.settings.edition) : getEdition(env.defaultEdition).key,
    pipeline,
    offers: offerRows.map((offer) => ({
      id: offer.id,
      name: offer.name,
      colour: offer.colour,
      description: offer.description,
      idealCustomer: offer.idealCustomer,
      positioning: offer.positioning,
      isDefault: offer.isDefault,
      active: offer.active,
      position: offer.position,
    })),
    stages: stageRows.map((stage) => ({
      id: stage.id,
      name: stage.name,
      colour: stage.colour,
      position: stage.position,
      terminalType: stage.terminalType,
    })),
    opportunities: mappedOpportunities,
    researchThemes: researchThemeRows.map((theme) => ({
      id: theme.id,
      position: theme.position,
      title: theme.title,
      audience: theme.audience,
      problem: theme.problem,
      signal: theme.signal,
      angle: theme.angle,
      status: theme.status === "ready" ? "ready" : theme.status === "evidence" ? "evidence" : "idea",
      offerId: theme.offerId,
      sourceUrls: theme.sourceUrls,
      updatedAt: theme.updatedAt.toISOString(),
    })),
    activityTypes: activityTypeRows.map((type) => ({
      id: type.id,
      name: type.name,
      channel: type.channel,
      icon: type.icon,
      colour: type.colour,
    })),
    users: userRows,
    generatedAt: new Date().toISOString(),
    demoMode: false,
    storageMode: "postgres",
  };
}
