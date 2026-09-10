import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { applyWorkspaceVoiceAction, loadVoiceWorkspaceAction, prepareWorkspaceVoiceAction, undoWorkspaceVoiceAction } from "./voice-workspace";

const mocks = vi.hoisted(() => ({ member: vi.fn(), snapshot: vi.fn(), interpret: vi.fn(), prepare: vi.fn(), apply: vi.fn(), undo: vi.fn(), rate: vi.fn(), enabled: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentMember: mocks.member }));
vi.mock("@/lib/ai/voice-workspace", () => ({ interpretWorkspaceVoice: mocks.interpret }));
vi.mock("@/lib/data/crm-repository", () => ({ getBoardSnapshot: mocks.snapshot }));
vi.mock("@/lib/data/voice-workspace-repository", async (actual) => ({ ...await actual<object>(), prepareVoicePlan: mocks.prepare, applyVoicePlan: mocks.apply, undoVoicePlan: mocks.undo }));
vi.mock("@/lib/data/local-store", () => ({ consumeLocalAiRateLimit: mocks.rate, getLocalAiEnabled: mocks.enabled }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/env", () => ({ env: { aiEnabled: true, AI_PROVIDER: "openai", OPENAI_API_KEY: "test-placeholder", AI_RATE_LIMIT: 6 } }));
const actor = { id: "member", organisationId: "workspace", storageMode: "sqlite", role: "member" };
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue(actor); mocks.snapshot.mockResolvedValue(demoBoardForEdition("service")); mocks.rate.mockReturnValue(true); mocks.enabled.mockReturnValue(true); });
describe("shared voice server action boundaries", () => {
  it("requires authentication for every entry point", async () => {
    mocks.member.mockResolvedValue(null);
    const target = { kind: "sales", id: crypto.randomUUID() };
    for (const result of [await loadVoiceWorkspaceAction(), await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "Europe/London" }), await applyWorkspaceVoiceAction({ planId: crypto.randomUUID(), changes: { salesValue: 0 } }), await undoWorkspaceVoiceAction({ receiptId: crypto.randomUUID() })]) expect(result.ok).toBe(false);
    expect(mocks.interpret).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.undo).not.toHaveBeenCalled();
  });
  it("rejects foreign records and invalid timezones before contacting AI", async () => {
    const target = { kind: "sales", id: crypto.randomUUID() };
    expect((await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "not-a-zone" })).ok).toBe(false);
    expect((await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "Europe/London" })).ok).toBe(false);
    expect(mocks.interpret).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("enforces AI settings and the request limit without changing CRM data", async () => {
    const target = { kind: "sales", id: demoBoardForEdition("service").opportunities[0].id };
    mocks.enabled.mockReturnValue(false);
    expect((await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "Europe/London" })).ok).toBe(false);
    mocks.enabled.mockReturnValue(true); mocks.rate.mockReturnValue(false);
    expect((await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "Europe/London" })).ok).toBe(false);
    expect(mocks.interpret).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("does not create a plan for an ambiguous request", async () => {
    const target = { kind: "sales", id: demoBoardForEdition("service").opportunities[0].id };
    mocks.interpret.mockResolvedValue({ clarification: "Which client?", changes: null });
    expect(await prepareWorkspaceVoiceAction({ target, transcript: "An update", timezone: "Europe/London" })).toEqual({ ok: false, error: "Which client?" });
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
});
