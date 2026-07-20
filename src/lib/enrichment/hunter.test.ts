import { describe, expect, it, vi } from "vitest";

import { findEmailWithHunter } from "@/lib/enrichment/hunter";

describe("Hunter email enrichment", () => {
  it("returns a sourced professional email without exposing the key", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const requested = new URL(String(url));
      expect(requested.searchParams.get("domain")).toBe("example.com");
      expect(requested.searchParams.get("full_name")).toBe("Alex Example");
      expect(requested.searchParams.get("api_key")).toBe("secret-key");
      return new Response(JSON.stringify({
        data: {
          email: "alex@example.com",
          score: 94,
          sources: [{ uri: "https://example.com/team" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await expect(findEmailWithHunter({ domain: "example.com", fullName: "Alex Example" }, "secret-key", fetcher)).resolves.toEqual({
      email: "alex@example.com",
      score: 94,
      sourceUrls: ["https://example.com/team"],
    });
  });

  it("explains an exhausted allowance or request limit", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: [] }), { status: 429 })) as typeof fetch;
    await expect(findEmailWithHunter({ domain: "example.com", fullName: "Alex Example" }, "secret-key", fetcher)).rejects.toThrow("allowance or request limit");
  });
});
