import type { BoardSnapshot, OpportunitySummary } from "@/lib/domain/types";

export const AI_PROMPT_VERSION = "coach-v3";

const approvedPlaybook = [
  "Lead with a specific operational observation before asking for time.",
  "Use only proof recorded and approved in the CRM; never invent customers, outcomes or urgency.",
  "Prefer a small next step: a referral, useful observation, short comparison call, or relevant one-page resource.",
  "Treat email, LinkedIn, phone and thoughtful physical touches as complementary channels; do not repeat the same nudge mechanically.",
  "Respect an incumbent system and test whether the frontline routine and evidence retrieval work well.",
  "If timing is poor, ask for a legitimate future trigger rather than manufacturing pressure.",
];

export type AICoachContext = ReturnType<typeof assembleAICoachContext>;

export function assembleAICoachContext(snapshot: BoardSnapshot, opportunity: OpportunitySummary) {
  const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
  const activities = opportunity.activities
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      type: item.type.name,
      channel: item.type.channel,
      contact: item.contactName,
      outcome: clean(item.outcome, 300),
      notes: clean(item.notes, 1_000),
      occurredAt: item.occurredAt,
    }));
  const tasks = opportunity.tasks
    .slice()
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt))
    .slice(0, 8)
    .map((item) => ({ id: item.id, title: clean(item.title, 300), dueAt: item.dueAt, status: item.status }));

  return {
    generatedAt: snapshot.generatedAt,
    company: {
      id: opportunity.company.id,
      name: opportunity.company.name,
      sector: opportunity.company.sector,
      fitScore: opportunity.company.fitScore,
      scaleNote: clean(opportunity.company.scaleNote, 500),
      doNotContact: opportunity.company.doNotContact,
    },
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      stage: stage?.name ?? "Unknown",
      stageType: stage?.terminalType ?? "open",
      priority: opportunity.priority,
      temperature: opportunity.temperature,
      owner: opportunity.owner?.name ?? null,
      outreachAngle: clean(opportunity.outreachAngle, 1_200),
      lastActivityAt: opportunity.lastActivityAt,
      nextActionAt: opportunity.nextActionAt,
      noNextActionReason: clean(opportunity.noNextActionReason, 400),
    },
    offer: opportunity.offer ? {
      id: opportunity.offer.id,
      name: opportunity.offer.name,
      description: clean(opportunity.offer.description, 1_000),
      idealCustomer: clean(opportunity.offer.idealCustomer, 1_000),
      positioning: clean(opportunity.offer.positioning, 1_000),
    } : null,
    contacts: opportunity.contacts.slice(0, 5).map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      primary: item.primary,
      hasEmail: Boolean(item.email),
      hasPhone: Boolean(item.phone),
      hasLinkedin: Boolean(item.linkedinUrl),
      preferredChannel: item.preferredChannel ?? null,
      doNotContact: item.doNotContact,
    })),
    recentActivities: activities,
    tasks,
    approvedPlaybook,
    contextReferences: {
      companyIds: [opportunity.company.id],
      opportunityIds: [opportunity.id],
      offerIds: opportunity.offer ? [opportunity.offer.id] : [],
      contactIds: opportunity.contacts.slice(0, 5).map((item) => item.id),
      activityIds: activities.map((item) => item.id),
      taskIds: tasks.map((item) => item.id),
    },
  };
}

function clean(value: string | null | undefined, max: number) {
  return value?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max) || null;
}
