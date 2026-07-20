import type { BoardSnapshot, OpportunitySummary, StageSummary } from "@/lib/domain/types";

const researchStageNames = new Set(["Researching", "Research holding"]);

export function isResearchStage(stage: Pick<StageSummary, "name"> | undefined) {
  return Boolean(stage && researchStageNames.has(stage.name));
}

export function getResearchTargets(snapshot: BoardSnapshot) {
  const researchStageIds = new Set(
    snapshot.stages.filter((stage) => isResearchStage(stage)).map((stage) => stage.id),
  );
  return snapshot.opportunities.filter((opportunity) => researchStageIds.has(opportunity.stageId));
}

export function getSalesBoardSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  const stages = snapshot.stages.filter((stage) => !isResearchStage(stage));
  const stageIds = new Set(stages.map((stage) => stage.id));
  return {
    ...snapshot,
    stages,
    opportunities: snapshot.opportunities.filter((opportunity) => stageIds.has(opportunity.stageId)),
  };
}

export type ResearchReadiness = "ready" | "needs_contact" | "needs_evidence" | "held";

export function researchReadiness(opportunity: OpportunitySummary, stage: StageSummary | undefined): ResearchReadiness {
  if (stage?.name === "Research holding") return "held";
  const hasEvidence = Boolean(opportunity.company.researchNote?.trim() || opportunity.company.sourceUrls?.length);
  const hasContactRoute = opportunity.contacts.some((contact) =>
    Boolean(contact.email || contact.phone || contact.linkedinUrl),
  );
  if (!hasEvidence) return "needs_evidence";
  if (!hasContactRoute) return "needs_contact";
  return "ready";
}
