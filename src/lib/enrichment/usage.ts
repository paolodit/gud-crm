import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { getLocalSetting, setLocalSetting } from "@/lib/data/local-store";
import type { StorageMode } from "@/lib/domain/types";
import type { FreeMaxProvider, FreeMaxStatus } from "@/lib/enrichment/freemax";
import { getFreeMaxRuntimeConfiguration } from "@/lib/enrichment/config";
import { env } from "@/lib/env";

const settingKey = "freemax_enrichment_usage";

type LocalFreeMaxUsage = {
  hunterMonth: string;
  hunterSuccessful: number;
  norbertSuccessful: number;
};

export async function getFreeMaxStatus(organisationId: string, storageMode: StorageMode): Promise<FreeMaxStatus> {
  const configuration = await getFreeMaxRuntimeConfiguration(organisationId, storageMode);
  const month = currentMonth();
  let hunterUsed = 0;
  let norbertUsed = 0;

  if (storageMode === "sqlite") {
    const stored = getLocalSetting<LocalFreeMaxUsage>(settingKey);
    hunterUsed = stored?.hunterMonth === month ? safeCount(stored.hunterSuccessful) : 0;
    norbertUsed = safeCount(stored?.norbertSuccessful);
  } else if (storageMode === "postgres") {
    const rows = await db.select({ after: auditEvents.after, createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.organisationId, organisationId), eq(auditEvents.action, "contact.enriched")));
    hunterUsed = rows.filter((row) => row.createdAt.toISOString().slice(0, 7) === month && row.after?.provider === "hunter").length;
    norbertUsed = rows.filter((row) => row.after?.provider === "norbert").length;
  }

  return {
    hunter: {
      configured: Boolean(configuration.keys.hunter),
      used: hunterUsed,
      limit: env.HUNTER_FREE_MONTHLY_LIMIT,
      cadence: "monthly",
    },
    norbert: {
      configured: Boolean(configuration.keys.norbert),
      used: norbertUsed,
      limit: env.NORBERT_FREE_LIFETIME_LIMIT,
      cadence: "starter",
    },
    order: configuration.order,
  };
}

export function recordLocalFreeMaxSuccess(provider: FreeMaxProvider) {
  const month = currentMonth();
  const stored = getLocalSetting<LocalFreeMaxUsage>(settingKey);
  const usage: LocalFreeMaxUsage = {
    hunterMonth: month,
    hunterSuccessful: stored?.hunterMonth === month ? safeCount(stored.hunterSuccessful) : 0,
    norbertSuccessful: safeCount(stored?.norbertSuccessful),
  };
  if (provider === "hunter") usage.hunterSuccessful += 1;
  else usage.norbertSuccessful += 1;
  setLocalSetting(settingKey, usage);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
