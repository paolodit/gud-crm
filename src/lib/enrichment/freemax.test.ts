import { describe, expect, it, vi } from "vitest";

import { findWorkEmailFreeMax, type FreeMaxStatus } from "@/lib/enrichment/freemax";

const available: FreeMaxStatus = {
  hunter: { configured: true, used: 0, limit: 50, cadence: "monthly" },
  norbert: { configured: true, used: 0, limit: 50, cadence: "starter" },
};

describe("FreeMax provider routing", () => {
  it("keeps Norbert untouched when Hunter succeeds", async () => {
    const hunter = vi.fn(async () => ({ email: "alex@example.com", score: 95, sourceUrls: [] }));
    const norbert = vi.fn(async () => ({ email: "backup@example.com", score: 90, sourceUrls: [] }));

    const result = await findWorkEmailFreeMax(
      { domain: "example.com", fullName: "Alex Example" },
      available,
      { hunter: "hunter-key", norbert: "norbert-key" },
      { hunter, norbert },
    );

    expect(result).toMatchObject({ found: true, provider: "hunter", email: "alex@example.com" });
    expect(hunter).toHaveBeenCalledOnce();
    expect(norbert).not.toHaveBeenCalled();
  });

  it("uses the Norbert starter pool only after a Hunter miss", async () => {
    const hunter = vi.fn(async () => ({ email: null, score: null, sourceUrls: [] }));
    const norbert = vi.fn(async () => ({ email: "alex@example.com", score: 92, sourceUrls: [] }));

    const result = await findWorkEmailFreeMax(
      { domain: "example.com", fullName: "Alex Example" },
      available,
      { hunter: "hunter-key", norbert: "norbert-key" },
      { hunter, norbert },
    );

    expect(result).toMatchObject({
      found: true,
      provider: "norbert",
      attempts: [
        { provider: "hunter", outcome: "not_found" },
        { provider: "norbert", outcome: "found" },
      ],
    });
  });

  it("never crosses the configured free safety caps", async () => {
    const hunter = vi.fn();
    const norbert = vi.fn();
    const capped: FreeMaxStatus = {
      hunter: { ...available.hunter, used: 50 },
      norbert: { ...available.norbert, used: 50 },
    };

    const result = await findWorkEmailFreeMax(
      { domain: "example.com", fullName: "Alex Example" },
      capped,
      { hunter: "hunter-key", norbert: "norbert-key" },
      { hunter, norbert },
    );

    expect(result).toMatchObject({ found: false, message: expect.stringContaining("No lookup was attempted beyond") });
    expect(hunter).not.toHaveBeenCalled();
    expect(norbert).not.toHaveBeenCalled();
  });
});
