import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FreeMaxSettingsCard } from "./freemax-settings-card";
import type { FreeMaxStatus } from "@/lib/enrichment/freemax";

vi.mock("@/app/actions/workspace", () => ({ saveFreeMaxConfigurationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const status: FreeMaxStatus = {
  hunter: { configured: true, used: 3, limit: 50, cadence: "monthly" },
  norbert: { configured: false, used: 0, limit: 50, cadence: "starter" },
  order: ["hunter", "norbert"],
};

describe("email provider settings access", () => {
  it("lets members see status but not credentials or configuration controls", () => {
    const html = renderToStaticMarkup(createElement(FreeMaxSettingsCard, { status, canManage: false }));
    expect(html).toContain("3/50 used");
    expect(html).toContain("Only an admin");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Disconnect Hunter");
  });
  it("shows an admin the setup form without returning a saved key", () => {
    const html = renderToStaticMarkup(createElement(FreeMaxSettingsCard, { status, canManage: true, "data-settings-tab": "ai" }));
    expect(html).toContain('data-settings-tab="ai"');
    expect(html).toContain('aria-label="Email provider setup"');
    expect(html).toContain("Disconnect Hunter");
    expect(html).toMatch(/<input[^>]+placeholder="Connected · paste to replace"[^>]+value=""/);
  });
});
