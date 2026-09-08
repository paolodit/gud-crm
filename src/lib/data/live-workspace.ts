import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, opportunities, auditEvents, users, offers } from "@/db/schema";
import { configuredDeliveryStages, deliveryDetails, deliveryStageListSchema, directProjects, directProjectSchema } from "@/lib/domain/delivery";
import { recordLocalAuditEvent, updateLocalBoardSnapshot } from "./local-store";
import type { CurrentMember } from "@/lib/session";

export const liveMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), project: directProjectSchema, create: z.boolean() }),
  z.object({ kind: z.literal("stages"), stages: deliveryStageListSchema, replacements: z.record(z.string(), z.string()).default({}) }),
]);

/** One tenant lock protects stage changes and standalone project edits from lost updates. */
export async function mutateLiveWorkspace(actor: CurrentMember, input: unknown) {
  const data = liveMutationSchema.parse(input);
  if (actor.storageMode === "demo") throw new Error("Use a saved workspace to manage projects.");
  if (data.kind === "stages" && actor.role !== "admin") throw new Error("Only admins can edit delivery stages.");
  const action = data.kind === "stages" ? "delivery.stages_updated" : data.create ? "project.created" : "project.updated";
  function mutate(settings: Record<string, unknown>, ownerIds: string[], offerIds: string[]) {
    const stages = configuredDeliveryStages(settings.deliveryStages);
    let projects = directProjects(settings.directProjects);
    if (data.kind === "project") {
      if (!stages.some((stage) => stage.id === data.project.delivery.stage)) throw new Error("Choose an existing delivery stage.");
      if (data.project.ownerId && !ownerIds.includes(data.project.ownerId)) throw new Error("Choose a workspace owner.");
      if (data.project.offerId && !offerIds.includes(data.project.offerId)) throw new Error("Choose a workspace offer.");
      const exists = projects.some((project) => project.id === data.project.id);
      if (data.create === exists) throw new Error(exists ? "Project already exists." : "Project was not found.");
      projects = data.create ? [...projects, data.project] : projects.map((project) => project.id === data.project.id ? data.project : project);
      return { ...settings, deliveryStages: stages, directProjects: projects };
    }
    for (const old of stages) {
      if (!data.stages.some((stage) => stage.id === old.id) && !data.stages.some((stage) => stage.id === data.replacements[old.id])) {
        throw new Error("Choose a replacement for each removed stage. Projects must keep a valid stage.");
      }
    }
    for (const [from, to] of Object.entries(data.replacements)) {
      if (!stages.some((stage) => stage.id === from) || data.stages.some((stage) => stage.id === from) || !data.stages.some((stage) => stage.id === to)) throw new Error("Stage replacements must map removed stages to retained stages.");
    }
    projects = projects.map((project) => ({ ...project, delivery: { ...project.delivery, stage: data.replacements[project.delivery.stage] ?? project.delivery.stage } }));
    return { ...settings, deliveryStages: data.stages, directProjects: projects };
  }
  if (actor.storageMode === "sqlite") {
    updateLocalBoardSnapshot((snapshot) => {
      const updated = mutate({ deliveryStages: snapshot.deliveryStages, directProjects: snapshot.directProjects }, snapshot.users.map((user) => user.id), snapshot.offers.map((offer) => offer.id));
      snapshot.deliveryStages = updated.deliveryStages;
      snapshot.directProjects = updated.directProjects;
      if (data.kind === "stages") for (const opportunity of snapshot.opportunities) {
        const delivery = deliveryDetails(opportunity.delivery);
        if (data.replacements[delivery.stage]) opportunity.delivery = { ...delivery, stage: data.replacements[delivery.stage] };
      }
    });
    recordLocalAuditEvent({ actorId: actor.id, action, entityType: "delivery", entityId: data.kind === "project" ? data.project.id : actor.organisationId, detail: data });
    return;
  }
  await db.transaction(async (tx) => {
    const [org] = await tx.select().from(organisations).where(eq(organisations.id, actor.organisationId)).for("update");
    if (!org) throw new Error("Workspace not found.");
    const members = await tx.select({ id: users.id }).from(users).where(eq(users.organisationId, actor.organisationId));
    const workspaceOffers = await tx.select({ id: offers.id }).from(offers).where(eq(offers.organisationId, actor.organisationId));
    const updated = mutate(org.settings, members.map((user) => user.id), workspaceOffers.map((offer) => offer.id));
    if (data.kind === "stages") {
      const records = await tx.select().from(opportunities).where(eq(opportunities.organisationId, actor.organisationId)).for("update");
      for (const record of records) {
        const delivery = deliveryDetails(record.delivery);
        if (data.replacements[delivery.stage]) await tx.update(opportunities).set({ delivery: { ...delivery, stage: data.replacements[delivery.stage] }, updatedAt: new Date() }).where(and(eq(opportunities.id, record.id), eq(opportunities.organisationId, actor.organisationId)));
      }
    }
    await tx.update(organisations).set({ settings: updated }).where(eq(organisations.id, actor.organisationId));
    await tx.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action, entityType: "delivery", entityId: data.kind === "project" ? data.project.id : actor.organisationId, after: data });
  });
}
