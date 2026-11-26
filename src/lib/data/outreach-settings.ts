import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents, organisations } from "@/db/schema";
import { getLocalSetting, localDatabaseForPrivateData, recordLocalAuditEvent, setLocalSetting } from "@/lib/data/local-store";
import { outreachGuideSchema, outreachScripts, type OutreachGuide } from "@/lib/domain/outreach";
import type { CurrentMember } from "@/lib/session";

const featureKey = "sales_cockpit";
const guideKey = "outreach_guide";

function guideVersion(value: unknown) {
  const parsed = outreachGuideSchema.safeParse(value);
  const guide = parsed.success ? parsed.data : outreachScripts;
  const revision = createHash("sha256").update(JSON.stringify(guide)).digest("hex");
  return { guide, revision };
}

export async function getOutreachGuide(member: CurrentMember) {
  if (member.storageMode === "sqlite") return guideVersion(getLocalSetting(guideKey));
  const [row] = await db.select({ settings: organisations.settings }).from(organisations)
    .where(eq(organisations.id, member.organisationId)).limit(1);
  return guideVersion(row?.settings[guideKey]);
}

export async function saveOutreachGuide(member: CurrentMember | null, guide: OutreachGuide, revision: string) {
  if (!canUseOutreach(member) || member.role !== "admin") return false;
  const updated = guideVersion(guide);
  if (member.storageMode === "sqlite") {
    return localDatabaseForPrivateData().transaction(() => {
      if (getLocalSetting<boolean>(featureKey) !== true || guideVersion(getLocalSetting(guideKey)).revision !== revision) return false;
      setLocalSetting(guideKey, guide);
      recordLocalAuditEvent({ actorId: member.id, action: "outreach.guide.updated", entityType: "organisation", entityId: member.organisationId, detail: { revision: updated.revision } });
      return updated;
    })();
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ settings: organisations.settings }).from(organisations)
      .where(eq(organisations.id, member.organisationId)).for("update");
    if (row?.settings[featureKey] !== true || guideVersion(row.settings[guideKey]).revision !== revision) return false;
    await tx.update(organisations).set({ settings: sql`${organisations.settings} || ${JSON.stringify({ [guideKey]: guide })}::jsonb`, updatedAt: new Date() })
      .where(eq(organisations.id, member.organisationId));
    await tx.insert(auditEvents).values({
      organisationId: member.organisationId, actorId: member.id, action: "outreach.guide.updated",
      entityType: "organisation", entityId: member.organisationId, after: { revision: updated.revision },
    });
    return updated;
  });
}

export function canUseOutreach(member: CurrentMember | null): member is CurrentMember {
  return Boolean(member && !member.demoMode && !member.impersonated);
}

export async function outreachEnabled(member: CurrentMember | null) {
  if (!canUseOutreach(member)) return false;
  if (member.storageMode === "sqlite") return getLocalSetting<boolean>(featureKey) === true;
  const [row] = await db.select({ settings: organisations.settings }).from(organisations)
    .where(eq(organisations.id, member.organisationId)).limit(1);
  return row?.settings[featureKey] === true;
}

export async function saveOutreachEnabled(member: CurrentMember | null, enabled: boolean) {
  if (!canUseOutreach(member) || member.role !== "admin") return false;
  if (member.storageMode === "sqlite") {
    localDatabaseForPrivateData().transaction(() => {
      setLocalSetting(featureKey, enabled);
      recordLocalAuditEvent({ actorId: member.id, action: "outreach.settings.updated", entityType: "organisation", entityId: member.organisationId, detail: { enabled } });
    })();
    return true;
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(organisations)
      .set({ settings: sql`${organisations.settings} || ${JSON.stringify({ [featureKey]: enabled })}::jsonb`, updatedAt: new Date() })
      .where(eq(organisations.id, member.organisationId)).returning({ id: organisations.id });
    if (!row) return false;
    await tx.insert(auditEvents).values({ organisationId: row.id, actorId: member.id, action: "outreach.settings.updated", entityType: "organisation", entityId: row.id, after: { enabled } });
    return true;
  });
}

export async function lockOutreachEnabled(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], organisationId: string) {
  const [row] = await tx.select({ settings: organisations.settings }).from(organisations)
    .where(eq(organisations.id, organisationId)).for("share");
  return row?.settings[featureKey] === true;
}
