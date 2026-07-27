import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { getLocalSetting, setLocalSetting } from "@/lib/data/local-store";
import type { StorageMode } from "@/lib/domain/types";
import type { FreeMaxProvider } from "@/lib/enrichment/freemax";
import { env } from "@/lib/env";

const localSettingKey = "freemax_credentials";

type StoredFreeMaxCredentials = {
  hunter?: string | null;
  norbert?: string | null;
  primary?: FreeMaxProvider;
};

export type FreeMaxRuntimeConfiguration = {
  keys: Partial<Record<FreeMaxProvider, string>>;
  order: FreeMaxProvider[];
};

export async function getFreeMaxRuntimeConfiguration(organisationId: string, storageMode: StorageMode): Promise<FreeMaxRuntimeConfiguration> {
  const stored = await readStoredConfiguration(organisationId, storageMode);
  const primary = stored?.primary === "norbert" ? "norbert" : "hunter";
  return {
    keys: {
      hunter: resolveKey("hunter", stored, organisationId, env.HUNTER_API_KEY),
      norbert: resolveKey("norbert", stored, organisationId, env.VOILA_NORBERT_API_KEY),
    },
    order: primary === "hunter" ? ["hunter", "norbert"] : ["norbert", "hunter"],
  };
}

export async function saveFreeMaxRuntimeConfiguration(
  organisationId: string,
  storageMode: StorageMode,
  input: {
    hunterKey: string;
    norbertKey: string;
    disconnectHunter: boolean;
    disconnectNorbert: boolean;
    primary: FreeMaxProvider;
  },
) {
  const current = await readStoredConfiguration(organisationId, storageMode) ?? {};
  const next: StoredFreeMaxCredentials = { ...current, primary: input.primary };
  if (input.disconnectHunter) next.hunter = null;
  else if (input.hunterKey) next.hunter = encryptSecret(input.hunterKey, organisationId);
  if (input.disconnectNorbert) next.norbert = null;
  else if (input.norbertKey) next.norbert = encryptSecret(input.norbertKey, organisationId);

  if (storageMode === "sqlite") {
    setLocalSetting(localSettingKey, next);
    return;
  }
  if (storageMode === "postgres") {
    const [row] = await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1);
    if (!row) throw new Error("Workspace not found.");
    await db.update(organisations).set({
      settings: { ...row.settings, freeMaxCredentials: next },
      updatedAt: new Date(),
    }).where(eq(organisations.id, organisationId));
  }
}

async function readStoredConfiguration(organisationId: string, storageMode: StorageMode): Promise<StoredFreeMaxCredentials | null> {
  if (storageMode === "sqlite") return getLocalSetting<StoredFreeMaxCredentials>(localSettingKey);
  if (storageMode !== "postgres") return null;
  const [row] = await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1);
  const value = row?.settings?.freeMaxCredentials;
  return value && typeof value === "object" && !Array.isArray(value) ? value as StoredFreeMaxCredentials : null;
}

function resolveKey(
  provider: FreeMaxProvider,
  stored: StoredFreeMaxCredentials | null,
  organisationId: string,
  environmentKey?: string,
) {
  if (stored && Object.prototype.hasOwnProperty.call(stored, provider)) {
    const value = stored[provider];
    return typeof value === "string" ? decryptSecret(value, organisationId) ?? undefined : undefined;
  }
  return environmentKey;
}

function encryptionKey(organisationId: string) {
  return createHash("sha256").update(`gud-crm:freemax:${organisationId}:${env.authSecret}`).digest();
}

function encryptSecret(value: string, organisationId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(organisationId), iv);
  cipher.setAAD(Buffer.from(organisationId));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string, organisationId: string) {
  try {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(organisationId), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(organisationId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
