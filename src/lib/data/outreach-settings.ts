import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents, organisations } from "@/db/schema";
import { getLocalSetting, localDatabaseForPrivateData, recordLocalAuditEvent, setLocalSetting } from "@/lib/data/local-store";
import type { CurrentMember } from "@/lib/session";

const featureKey = "sales_cockpit";

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
