"use server";

import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { publicActionError } from "@/lib/action-error";
import { recordLocalAuditEvent } from "@/lib/data/local-store";
import { env } from "@/lib/env";
import { getCurrentMember } from "@/lib/session";

type UpdateResult = { ok: true; message: string } | { ok: false; error: string };

export async function prepareSafeUpdateAction(): Promise<UpdateResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.role !== "admin") return { ok: false, error: "Only workspace admins can request an update." };
  if (!env.GUD_BACKUP_WEBHOOK_URL || !env.GUD_DEPLOY_WEBHOOK_URL) {
    return { ok: false, error: "Connect both the verified backup and deployment webhooks before enabling one-click updates." };
  }
  try {
    const backupResponse = await fetch(env.GUD_BACKUP_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "backup-before-update", instance: env.instanceName, requestedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!backupResponse.ok) throw new Error(`Backup preflight returned ${backupResponse.status}.`);

    if (member.storageMode === "sqlite") {
      recordLocalAuditEvent({ actorId: member.id, action: "system.update_requested", entityType: "deployment", entityId: env.GUD_VERSION, detail: { backupVerified: true } });
    } else if (member.storageMode === "postgres") {
      await db.insert(auditEvents).values({ organisationId: member.organisationId, actorId: member.id, action: "system.update_requested", entityType: "deployment", entityId: crypto.randomUUID(), after: { fromVersion: env.GUD_VERSION, backupVerified: true } });
    }

    const deployResponse = await fetch(env.GUD_DEPLOY_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deploy-approved-release", instance: env.instanceName, currentVersion: env.GUD_VERSION }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!deployResponse.ok) throw new Error(`Deployment request returned ${deployResponse.status}.`);
    return { ok: true, message: "Backup verified and update requested. The app will return after CapRover completes its health check." };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The safe update could not be started. No database changes were requested by GUD.") };
  }
}
