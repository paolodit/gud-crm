import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, companies, opportunities, organisations, stages } from "@/db/schema";
import { configuredDeliveryStages, deliveryDetails, directProjects, liveProjectRecords, type LiveProject } from "@/lib/domain/delivery";
import { liveOrderSchema, moveLiveProject } from "@/lib/domain/live-order";
import type { CurrentMember } from "@/lib/session";
import { recordLocalAuditEvent, updateLocalBoardSnapshot } from "./local-store";

export async function reorderLiveProject(actor: CurrentMember, input: unknown) {
  const move = liveOrderSchema.parse(input);
  if (actor.storageMode === "demo") throw new Error("Use a saved workspace to order projects.");
  function apply(records: LiveProject[], configured: unknown) {
    if (!configuredDeliveryStages(configured).some((stage) => stage.id === move.toStageId)) throw new Error("Choose an existing delivery stage.");
    return moveLiveProject(records, move);
  }
  if (actor.storageMode === "sqlite") {
    const saved = updateLocalBoardSnapshot((snapshot) => {
      const next = apply(liveProjectRecords(snapshot), snapshot.deliveryStages);
      for (const project of snapshot.directProjects ?? []) {
        const updated = next.find((item) => item.source === "direct" && item.id === project.id);
        if (updated) project.delivery = updated.delivery;
      }
      for (const opportunity of snapshot.opportunities) {
        const updated = next.find((item) => item.source === "sales" && item.id === opportunity.id);
        if (updated) opportunity.delivery = updated.delivery;
      }
      return next;
    });
    recordLocalAuditEvent({ actorId: actor.id, action: "delivery.reordered", entityType: "delivery", entityId: move.projectId, detail: move });
    return saved.map(({ id, delivery }) => ({ id, delivery }));
  }
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, actor.organisationId)).for("update");
    if (!org) throw new Error("Workspace not found.");
    const direct = directProjects(org.settings.directProjects);
    const rows = await tx.select({ opportunity: opportunities, companyName: companies.name }).from(opportunities)
      .innerJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.organisationId, actor.organisationId)))
      .innerJoin(stages, eq(stages.id, opportunities.stageId))
      .where(and(eq(opportunities.organisationId, actor.organisationId), eq(stages.terminalType, "won"), isNull(opportunities.archivedAt), isNull(companies.archivedAt))).orderBy(asc(opportunities.position)).for("update", { of: opportunities });
    const firstStage = configuredDeliveryStages(org.settings.deliveryStages)[0].id;
    const records: LiveProject[] = [
      ...rows.map(({ opportunity: item, companyName }): LiveProject => ({ id: item.id, title: item.title, companyName, ownerId: item.ownerId, offerId: item.offerId, delivery: deliveryDetails(item.delivery ?? { stage: firstStage }), source: "sales" })),
      ...direct.map((item): LiveProject => ({ ...item, source: "direct" })),
    ];
    const next = apply(records, org.settings.deliveryStages);
    const changed = next.filter((item) => { const old = records.find((record) => record.id === item.id)!; return old.delivery.stage !== item.delivery.stage || old.delivery.position !== item.delivery.position; });
    for (const item of changed.filter((item) => item.source === "sales")) await tx.update(opportunities).set({ delivery: item.delivery, updatedAt: new Date() }).where(and(eq(opportunities.id, item.id), eq(opportunities.organisationId, actor.organisationId)));
    if (changed.some((item) => item.source === "direct")) await tx.update(organisations).set({ settings: { ...org.settings, directProjects: direct.map((item) => { const updated = changed.find((record) => record.source === "direct" && record.id === item.id); return updated ? { ...item, delivery: updated.delivery } : item; }) }, updatedAt: new Date() }).where(eq(organisations.id, actor.organisationId));
    await tx.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action: "delivery.reordered", entityType: "delivery", entityId: move.projectId, after: move });
    return next.map(({ id, delivery }) => ({ id, delivery }));
  });
}
