import { describe, expect, it, vi } from "vitest";

import { findEmailWithNorbert } from "@/lib/enrichment/norbert";

describe("Voila Norbert email enrichment", () => {
  it("uses basic auth and the named-contact form endpoint", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.voilanorbert.com/2018-01-08/search/name");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from("gud-crm:secret-token").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(String(init?.body)).toBe("name=Alex+Example&domain=example.com");
      return new Response(JSON.stringify({
        id: 123,
        searching: false,
        email: { email: "alex@example.com", is_done: true, score: 97 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await expect(findEmailWithNorbert(
      { domain: "example.com", fullName: "Alex Example" },
      "secret-token",
      { fetcher },
    )).resolves.toEqual({ email: "alex@example.com", score: 97, sourceUrls: [] });
  });

  it("polls a search that is still processing", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123, searching: true, email: null }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 123,
        searching: false,
        email: { email: "alex@example.com", score: 91 },
      }), { status: 200 })) as typeof fetch;
    const wait = vi.fn(async () => undefined);

    await expect(findEmailWithNorbert(
      { domain: "example.com", fullName: "Alex Example" },
      "secret-token",
      { fetcher, wait },
    )).resolves.toMatchObject({ email: "alex@example.com", score: 91 });
    expect(wait).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.voilanorbert.com/2018-01-08/contacts/123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("stops cleanly when the starter credits are gone", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "No credits left" }), { status: 402 })) as typeof fetch;
    await expect(findEmailWithNorbert(
      { domain: "example.com", fullName: "Alex Example" },
      "secret-token",
      { fetcher },
    )).rejects.toThrow("no finder credits left");
  });
});
