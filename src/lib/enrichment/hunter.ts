import { z } from "zod";

import { EnrichmentProviderError } from "@/lib/enrichment/provider-error";

const hunterResponseSchema = z.object({
  data: z.object({
    email: z.string().email().nullable(),
    score: z.number().min(0).max(100).nullable().optional(),
    sources: z.array(z.object({
      uri: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(),
    })).optional().default([]),
  }),
  errors: z.array(z.object({ details: z.string().optional() })).optional(),
});

const hunterErrorSchema = z.object({
  errors: z.array(z.object({ details: z.string().optional() })).optional(),
});

export type HunterEmailResult = {
  email: string | null;
  score: number | null;
  sourceUrls: string[];
};

export async function findEmailWithHunter(
  input: { domain: string; fullName: string },
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<HunterEmailResult> {
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", input.domain);
  url.searchParams.set("full_name", input.fullName);
  url.searchParams.set("api_key", apiKey);

  const response = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = hunterErrorSchema.safeParse(payload);
    const detail = parsedError.success ? parsedError.data.errors?.[0]?.details : null;
    if (response.status === 401) {
      throw new EnrichmentProviderError("hunter", "invalid_key", "Hunter rejected the API key.");
    }
    if (response.status === 402) {
      throw new EnrichmentProviderError("hunter", "exhausted", "Hunter has no finder credits left.");
    }
    if (response.status === 429) {
      throw new EnrichmentProviderError("hunter", "rate_limited", "Hunter's free allowance or request limit has been reached.");
    }
    throw new EnrichmentProviderError("hunter", "provider_error", detail || "Hunter could not complete this lookup.");
  }
  const parsed = hunterResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Hunter returned an unexpected response.");
  return {
    email: parsed.data.data.email,
    score: parsed.data.data.score ?? null,
    sourceUrls: [...new Set(parsed.data.data.sources.flatMap((source) => source.uri ? [source.uri] : []))],
  };
}
