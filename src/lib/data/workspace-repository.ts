import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { getLocalSetting } from "@/lib/data/local-store";
import type { SalesAssetId, SalesAssetSummary, StorageMode } from "@/lib/domain/types";

export const salesAssetDefaults: SalesAssetSummary[] = [
  { id: "website", status: "untracked", url: "", note: "" },
  { id: "walkthrough", status: "untracked", url: "", note: "" },
  { id: "playable_demo", status: "untracked", url: "", note: "" },
  { id: "benefits_pdf", status: "untracked", url: "", note: "" },
  { id: "qualifier", status: "untracked", url: "", note: "" },
  { id: "compliance_research", status: "untracked", url: "", note: "" },
];

export async function getSalesAssets(organisationId: string, storageMode: StorageMode, offerId: string, useLegacyFallback = false) {
  let saved: SalesAssetSummary[] | null = null;
  if (storageMode === "sqlite") {
    const byOffer = getLocalSetting<Record<string, SalesAssetSummary[]>>("sales_assets_by_offer") ?? {};
    saved = byOffer[offerId] ?? (useLegacyFallback ? getLocalSetting<SalesAssetSummary[]>("sales_assets") : null);
  } else if (storageMode === "postgres") {
    const [row] = await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1);
    const byOffer = row?.settings?.salesAssetsByOffer;
    if (byOffer && typeof byOffer === "object" && !Array.isArray(byOffer)) {
      const value = (byOffer as Record<string, unknown>)[offerId];
      if (Array.isArray(value)) saved = value as SalesAssetSummary[];
    }
    if (!saved && useLegacyFallback) {
      const legacy = row?.settings?.salesAssets;
      if (Array.isArray(legacy)) saved = legacy as SalesAssetSummary[];
    }
  }
  const byId = new Map((saved ?? []).map((asset) => [asset.id, asset]));
  return salesAssetDefaults.map((asset) => ({ ...asset, ...(byId.get(asset.id as SalesAssetId) ?? {}) }));
}
