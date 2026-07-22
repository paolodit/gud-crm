import { existsSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { SettingsDashboard, type ImportStatus } from "@/components/crm-views";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getLocalAiEnabled } from "@/lib/data/local-store";
import { getFreeMaxStatus } from "@/lib/enrichment/usage";
import { env } from "@/lib/env";
import { previewTrackerImport } from "@/lib/import/tracker";
import { getCurrentMember } from "@/lib/session";

export default async function SettingsPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const snapshot = await getBoardSnapshot(member.organisationId);
  const [importStatus, freeMaxStatus] = await Promise.all([localImportStatus(), getFreeMaxStatus(member.organisationId, member.storageMode)]);
  const workspaceAiEnabled = member.storageMode === "sqlite"
    ? getLocalAiEnabled()
    : member.demoMode
      ? true
      : (await db.select({ enabled: organisations.aiEnabled }).from(organisations).where(eq(organisations.id, member.organisationId)).limit(1))[0]?.enabled ?? false;
  return (
    <SettingsDashboard
      snapshot={snapshot}
      runtime={{
        demoMode: env.demoMode,
        storageMode: env.storageMode,
        databaseConfigured: Boolean(env.DATABASE_URL),
        aiEnabled: env.aiEnabled,
        aiProvider: env.AI_PROVIDER,
        aiKeyConfigured: Boolean(env.OPENAI_API_KEY),
        aiModel: env.AI_MODEL,
        workspaceAiEnabled,
        passwordAuthActive: member.storageMode === "postgres",
        passwordResetConfigured: member.storageMode === "postgres" && env.authEmailConfigured,
        freeMaxStatus,
        version: env.GUD_VERSION,
        backupAutomationConfigured: Boolean(env.GUD_BACKUP_WEBHOOK_URL),
        safeUpdateConfigured: Boolean(env.GUD_BACKUP_WEBHOOK_URL && env.GUD_DEPLOY_WEBHOOK_URL),
      }}
      importStatus={importStatus}
      currentMemberId={member.id}
      currentRole={member.role}
    />
  );
}

async function localImportStatus(): Promise<ImportStatus> {
  const filePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.LOCAL_TRACKER_PATH);
  if (!existsSync(filePath)) return { available: false };
  try {
    const preview = await previewTrackerImport(filePath);
    return {
      available: true,
      fileName: preview.fileName,
      totalRows: preview.totalRows,
      companies: preview.companies,
      contacts: preview.contacts,
      duplicates: preview.duplicateSourceRows,
      invalid: preview.invalidRows,
    };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : "Preview failed." };
  }
}
