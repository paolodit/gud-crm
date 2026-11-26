import { describe, expect, it, vi } from "vitest";

import { draftOutreachCopy, lookUpOutreachSwitchboard, outreachLookupDomain } from "@/lib/ai/outreach";

const provider = vi.hoisted(() => ({ create: vi.fn(), parse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: { AI_MODEL: "test-model", AI_TIMEOUT_MS: 5_000 } }));

describe("Outreach AI", () => {
  it("scopes switchboard search and accepts only numbers backed by an official search result", async () => {
    const sourceUrl = "https://www.example.com/contact";
    const number = "020 7946 0959";
    const sources = [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: sourceUrl }] } }];
    provider.parse.mockResolvedValue({ status: "completed", output_parsed: { number, sourceUrl }, output: sources });
    await expect(lookUpOutreachSwitchboard("Example Retail", "example.com")).resolves.toEqual({ number, sourceUrl });
    expect(provider.parse).toHaveBeenCalledWith(expect.objectContaining({
      store: false, tools: [{ type: "web_search", filters: { allowed_domains: ["example.com"] } }],
    }), expect.anything());
    provider.parse.mockResolvedValueOnce({ status: "completed", output_parsed: { number, sourceUrl }, output: [] });
    await expect(lookUpOutreachSwitchboard("Example Retail", "example.com")).resolves.toBeNull();
    provider.parse.mockResolvedValueOnce({ status: "completed", output_parsed: { number, sourceUrl }, output: sources });
    await expect(lookUpOutreachSwitchboard("Other Retail", "example.org")).resolves.toBeNull();
    expect(outreachLookupDomain("https://company.internal/contact")).toBeNull();
    expect(outreachLookupDomain("https://www.example.com/contact")).toBe("example.com");
  });

  it("drafts only the chosen wording and supplied direction", async () => {
    const input = { field: "Gatekeeper opener", text: "Who manages store compliance?", direction: "Make it warmer" };
    provider.create.mockResolvedValueOnce({ status: "completed", output_text: " Could you point me to the person who looks after store compliance? " });
    await expect(draftOutreachCopy(input)).resolves.toBe("Could you point me to the person who looks after store compliance?");
    expect(provider.create).toHaveBeenCalledWith(expect.objectContaining({ store: false, input: [
      expect.objectContaining({ role: "system" }), { role: "user", content: JSON.stringify(input) },
    ] }), expect.anything());
  });
});
