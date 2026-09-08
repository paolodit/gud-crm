import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, companies, opportunities, organisations, stages } from "@/db/schema";
import { configuredDeliveryStages, deliveryDetails, deliveryUpdateSchema, getLiveProjects } from "@/lib/domain/delivery";
import { recordLocalAuditEvent, updateLocalBoardSnapshot } from "./local-store";

type Actor = { id: string; organisationId: string; storageMode?: "demo" | "sqlite" | "postgres" };

/** Delivery never changes the sales stage or detaches history. All writes are tenant-scoped. */
export async function updateDelivery(actor: Actor, input: unknown) {
  const data = deliveryUpdateSchema.parse(input);
  let saved = deliveryDetails({});
  if (actor.storageMode === "demo") throw new Error("Use a saved workspace to track live projects.");
  if (actor.storageMode === "sqlite") {
    updateLocalBoardSnapshot((snapshot) => {
      const configured = configuredDeliveryStages(snapshot.deliveryStages);
      if (data.delivery.stage && !configured.some((stage) => stage.id === data.delivery.stage)) throw new Error("Choose an existing delivery stage.");
      const project = getLiveProjects(snapshot.opportunities, snapshot.stages).find((item) => item.id === data.opportunityId);
      if (!project) throw new Error("Choose an unarchived, won opportunity for the live board.");
      saved = deliveryDetails({ ...deliveryDetails(project.delivery ?? { stage: configured[0].id }), ...data.delivery });
      project.delivery = saved;
    });
    recordLocalAuditEvent({ actorId: actor.id, action: "delivery.updated", entityType: "opportunity", entityId: data.opportunityId, detail: data.delivery });
  } else {
    await db.transaction(async (tx) => {
      const [org] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, actor.organisationId)).limit(1).for("update");
      if (!org) throw new Error("Workspace not found.");
      const configured = configuredDeliveryStages(org.settings.deliveryStages);
      if (data.delivery.stage && !configured.some((stage) => stage.id === data.delivery.stage)) throw new Error("Choose an existing delivery stage.");
      const [record] = await tx.select({ opportunity: opportunities, terminalType: stages.terminalType, companyArchived: companies.archivedAt })
        .from(opportunities).innerJoin(stages, eq(opportunities.stageId, stages.id))
        .innerJoin(companies, eq(opportunities.companyId, companies.id))
        .where(and(eq(opportunities.id, data.opportunityId), eq(opportunities.organisationId, actor.organisationId)))
        .limit(1).for("update", { of: opportunities });
      if (!record || record.terminalType !== "won" || record.opportunity.archivedAt || record.companyArchived) {
        throw new Error("Choose an unarchived, won opportunity for the live board.");
      }
      saved = deliveryDetails({ ...deliveryDetails(record.opportunity.delivery ?? { stage: configured[0].id }), ...data.delivery });
      await tx.update(opportunities).set({ delivery: saved, updatedAt: new Date() }).where(eq(opportunities.id, data.opportunityId));
      await tx.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action: "delivery.updated", entityType: "opportunity", entityId: data.opportunityId, before: record.opportunity.delivery, after: data.delivery });
    });
  }
  return { opportunityId: data.opportunityId, delivery: saved };
}
