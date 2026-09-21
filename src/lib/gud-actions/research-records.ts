import { and, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, offers, researchThemes } from "@/db/schema";
import type { CurrentMember } from "@/lib/session";
import { GudActionError, type GudDraft, type GudFields } from "./contract";

export async function readIdea(actor: CurrentMember, id: string, lock = false) {
  const query = db.select().from(researchThemes).where(and(eq(researchThemes.organisationId, actor.organisationId), eq(researchThemes.id, id)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new GudActionError("That marketing idea is unavailable in this workspace.");
  return row;
}
export async function validateResearchLinks(actor: CurrentMember, fields: GudFields) {
  if (fields.offerId) {
    const [offer] = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.organisationId, actor.organisationId), eq(offers.id, fields.offerId), eq(offers.active, true)));
    if (!offer) throw new GudActionError("Choose an available service from this workspace.");
  }
  for (const id of fields.researchThemeIds ?? []) await readIdea(actor, id);
  if (fields.clearOffer && fields.offerId) throw new GudActionError("Choose a service or clear it, not both.");
}
export async function saveIdea(actor: CurrentMember, draft: GudDraft) {
  const f = draft.fields;
  const existing = draft.targetId ? await readIdea(actor, draft.targetId, true) : null;
  const id = existing?.id ?? crypto.randomUUID();
  const [{ position }] = await db.select({ position: max(researchThemes.position) }).from(researchThemes).where(eq(researchThemes.organisationId, actor.organisationId));
  const values = {
    title: f.title ?? existing?.title ?? "", audience: f.audience ?? existing?.audience ?? null,
    problem: f.problem ?? existing?.problem ?? null, signal: f.signal ?? existing?.signal ?? null,
    angle: f.angle ?? existing?.angle ?? null, status: f.researchStatus ?? existing?.status ?? "idea",
    offerId: f.clearOffer ? null : f.offerId ?? existing?.offerId ?? null,
    sourceUrls: f.sourceUrls ?? existing?.sourceUrls ?? [], updatedAt: new Date(),
  };
  if (existing) await db.update(researchThemes).set(values).where(and(eq(researchThemes.organisationId, actor.organisationId), eq(researchThemes.id, id)));
  else await db.insert(researchThemes).values({ id, organisationId: actor.organisationId, ownerId: actor.id, position: (position ?? 0) + 1000, ...values });
  await db.insert(auditEvents).values({ organisationId: actor.organisationId, actorId: actor.id, action: "research_theme.voice_saved", entityType: "research_theme", entityId: id, after: values });
  return { href: `/research?idea=${id}`, label: values.title };
}
