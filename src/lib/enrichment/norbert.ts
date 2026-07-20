import { z } from "zod";

import { EnrichmentProviderError } from "@/lib/enrichment/provider-error";

const norbertContactSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  searching: z.boolean().optional().default(false),
  email: z.object({
    email: z.string().email(),
    is_done: z.boolean().optional(),
    score: z.coerce.number().min(0).max(100).nullable().optional(),
  }).nullable().optional(),
});

export type NorbertEmailResult = {
  email: string | null;
  score: number | null;
  sourceUrls: string[];
};

type NorbertOptions = {
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  pollAttempts?: number;
};

const endpoint = "https://api.voilanorbert.com/2018-01-08";

export async function findEmailWithNorbert(
  input: { domain: string; fullName: string },
  apiKey: string,
  options: NorbertOptions = {},
): Promise<NorbertEmailResult> {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const auth = Buffer.from(`gud-crm:${apiKey}`).toString("base64");
  const body = new URLSearchParams({ name: input.fullName, domain: input.domain });
  let contact = await requestNorbert(`${endpoint}/search/name`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }, fetcher);

  const pollAttempts = options.pollAttempts ?? 4;
  for (let attempt = 0; contact.searching && contact.id && attempt < pollAttempts; attempt += 1) {
    await wait(2_000);
    contact = await requestNorbert(`${endpoint}/contacts/${encodeURIComponent(String(contact.id))}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${auth}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }, fetcher);
  }

  if (contact.searching) {
    throw new EnrichmentProviderError("norbert", "pending", "Norbert is still searching. Try this contact again shortly; a duplicate lookup is not charged twice.");
  }

  return {
    email: contact.email?.email ?? null,
    score: contact.email?.score ?? null,
    sourceUrls: [],
  };
}

async function requestNorbert(url: string, init: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = errorDetail(payload);
    if (response.status === 401) {
      throw new EnrichmentProviderError("norbert", "invalid_key", "Norbert rejected the API key.");
    }
    if (response.status === 402) {
      throw new EnrichmentProviderError("norbert", "exhausted", "Norbert has no finder credits left.");
    }
    if (response.status === 429) {
      throw new EnrichmentProviderError("norbert", "rate_limited", "Norbert is rate-limiting lookups. Try again shortly.");
    }
    throw new EnrichmentProviderError("norbert", "provider_error", detail || "Norbert could not complete this lookup.");
  }

  const parsed = norbertContactSchema.safeParse(payload);
  if (!parsed.success) {
    throw new EnrichmentProviderError("norbert", "provider_error", "Norbert returned an unexpected response.");
  }
  return parsed.data;
}

function errorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = "error" in payload ? payload.error : null;
  return typeof value === "string" ? value : null;
}
