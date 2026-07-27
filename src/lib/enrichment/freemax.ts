import { findEmailWithHunter, type HunterEmailResult } from "@/lib/enrichment/hunter";
import { findEmailWithNorbert, type NorbertEmailResult } from "@/lib/enrichment/norbert";

export type FreeMaxProvider = "hunter" | "norbert";

export type FreeMaxProviderStatus = {
  configured: boolean;
  used: number;
  limit: number;
  cadence: "monthly" | "starter";
};

export type FreeMaxStatus = {
  hunter: FreeMaxProviderStatus;
  norbert: FreeMaxProviderStatus;
  order: FreeMaxProvider[];
};

export type FreeMaxAttempt = {
  provider: FreeMaxProvider;
  outcome: "found" | "not_found" | "error";
  detail?: string;
};

type ProviderResult = HunterEmailResult | NorbertEmailResult;
type ProviderAdapter = (input: { domain: string; fullName: string }, apiKey: string) => Promise<ProviderResult>;

export type FreeMaxLookupResult =
  | {
      found: true;
      provider: FreeMaxProvider;
      email: string;
      score: number | null;
      sourceUrls: string[];
      attempts: FreeMaxAttempt[];
    }
  | { found: false; message: string; attempts: FreeMaxAttempt[] };

export async function findWorkEmailFreeMax(
  input: { domain: string; fullName: string },
  status: FreeMaxStatus,
  keys: { hunter?: string; norbert?: string },
  adapters: Partial<Record<FreeMaxProvider, ProviderAdapter>> = {},
): Promise<FreeMaxLookupResult> {
  const attempts: FreeMaxAttempt[] = [];
  const configured = status.hunter.configured || status.norbert.configured;
  if (!configured) {
    return { found: false, attempts, message: "Add a Hunter or Voila Norbert API key to the server environment to enable FreeMax email finding." };
  }

  const providersById: Record<FreeMaxProvider, { id: FreeMaxProvider; key?: string; available: boolean; lookup: ProviderAdapter }> = {
    hunter: {
      id: "hunter",
      key: keys.hunter,
      available: status.hunter.configured && status.hunter.used < status.hunter.limit,
      lookup: adapters.hunter ?? findEmailWithHunter,
    },
    norbert: {
      id: "norbert",
      key: keys.norbert,
      available: status.norbert.configured && status.norbert.used < status.norbert.limit,
      lookup: adapters.norbert ?? findEmailWithNorbert,
    },
  };
  const providers = status.order.map((provider) => providersById[provider]);

  for (const provider of providers) {
    if (!provider.available || !provider.key) continue;
    try {
      const result = await provider.lookup(input, provider.key);
      if (result.email) {
        attempts.push({ provider: provider.id, outcome: "found" });
        return { found: true, provider: provider.id, email: result.email, score: result.score, sourceUrls: result.sourceUrls, attempts };
      }
      attempts.push({ provider: provider.id, outcome: "not_found" });
    } catch (error) {
      attempts.push({
        provider: provider.id,
        outcome: "error",
        detail: error instanceof Error ? error.message : `${providerLabel(provider.id)} could not complete the lookup.`,
      });
    }
  }

  if (!providers.some((provider) => provider.available && provider.key)) {
    return { found: false, attempts, message: "FreeMax has reached GUD CRM's configured free-first safety caps. No lookup was attempted beyond them." };
  }

  const pending = attempts.find((attempt) => attempt.detail?.includes("still searching"));
  if (pending?.detail) return { found: false, attempts, message: pending.detail };
  const tried = attempts.map((attempt) => providerLabel(attempt.provider)).join(" and ");
  return {
    found: false,
    attempts,
    message: `FreeMax tried ${tried || "the available providers"}, but no reliable work email was found. Unsuccessful searches do not use finder credits.`,
  };
}

export function providerLabel(provider: FreeMaxProvider) {
  return provider === "hunter" ? "Hunter" : "Voila Norbert";
}
