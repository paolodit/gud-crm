"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, opportunities, researchThemes } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getLocalBoardSnapshot, updateLocalBoardSnapshot } from "@/lib/data/local-store";

export async function saveTargetIdeasAction(raw: unknown) {
  const parsed = z.object({ targetId: z.uuid(), ideaIds: z.array(z.uuid()).max(30) }).safeParse(raw);
  const actor = await getCurrentMember();
  if (!actor || actor.demoMode || !parsed.success) return { ok: false, error: "These target links cannot be saved here." };
  const { targetId, ideaIds } = parsed.data;
  try {
    if (actor.storageMode === "sqlite") {
      const snapshot = getLocalBoardSnapshot();
      if (!snapshot.opportunities.some(t => t.id === targetId) || ideaIds.some(id => !snapshot.researchThemes.some(i => i.id === id))) throw new Error("Unavailable");
      updateLocalBoardSnapshot(s => { s.opportunities.find(t => t.id === targetId)!.researchThemeIds = [...new Set(ideaIds)]; });
    } else await db.transaction(async tx => {
      const [target] = await tx.select().from(opportunities).where(and(eq(opportunities.organisationId, actor.organisationId), eq(opportunities.id, targetId))).for("update");
      const ideas = await tx.select({ id: researchThemes.id }).from(researchThemes).where(eq(researchThemes.organisationId, actor.organisationId));
      if (!target || ideaIds.some(id => !ideas.some(i => i.id === id))) throw new Error("Unavailable");
      await tx.update(opportunities).set({ importMetadata: { ...target.importMetadata, researchThemeIds: [...new Set(ideaIds)] }, updatedAt: new Date() }).where(and(eq(opportunities.organisationId, actor.organisationId), eq(opportunities.id, targetId)));
      await tx.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action: "target.ideas_linked", entityType: "opportunity", entityId: targetId, after: { ideaIds } });
    });
    revalidatePath("/targets"); return { ok: true };
  } catch { return { ok: false, error: "Could not save these links. Refresh the target and try again." }; }
}
