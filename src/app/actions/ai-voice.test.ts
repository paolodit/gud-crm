import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { parseSpokenCrmDraftAction } from "./ai";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), snapshot: vi.fn(), audit: vi.fn(), env: { aiEnabled: true, AI_PROVIDER: "openai", OPENAI_API_KEY: "test-placeholder", AI_MODEL: "test-model", AI_TIMEOUT_MS: 1000, AI_RATE_LIMIT: 10 } }));
vi.mock("openai", () => ({ default: class { responses = { parse: mocks.parse }; } }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/data/crm-repository", () => ({ getBoardSnapshot: mocks.snapshot }));
vi.mock("@/lib/session", () => ({ getCurrentMember: async () => ({ id: "user", organisationId: "workspace", name: "Alex", storageMode: "sqlite", demoMode: false }) }));
vi.mock("@/lib/data/local-store", () => ({ getLocalAiEnabled: () => true, consumeLocalAiRateLimit: () => true, recordLocalAuditEvent: mocks.audit }));
const fields = ["companyName", "sector", "websiteUrl", "companyLinkedinUrl", "fitScore", "scaleNote", "researchNote", "title", "offerName", "ownerName", "priority", "temperature", "expectedValue", "probability", "expectedCloseDate", "outreachAngle", "contactName", "contactTitle", "contactEmail", "contactPhone", "contactLinkedinUrl", "nextActionTitle", "nextActionAt", "activityTypeName", "activityOutcome", "activityNotes", "activityOccurredAt"];
beforeEach(() => { vi.clearAllMocks(); mocks.env.OPENAI_API_KEY = "test-placeholder"; });

describe("voice drafting boundary", () => {
  it("prepares a task-only draft using scoped record context without saving CRM work", async () => {
    const snapshot = demoBoardForEdition("service");
    const id = snapshot.opportunities[0].id;
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.parse.mockResolvedValue({ output_parsed: { ...Object.fromEntries(fields.map((name) => [name, null])), kind: "activity_update", nextActionTitle: "Send the outline", nextActionAt: "2026-10-16T10:00" } });
    const result = await parseSpokenCrmDraftAction({ kind: "activity_update", opportunityId: id, timezone: "Europe/London", transcript: "Create a task to send the outline on 16 October at 10am. No call has happened." });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.draft.activityTypeName).toBeNull(); expect(result.draft.nextActionTitle).toBe("Send the outline"); }
    expect(mocks.snapshot).toHaveBeenCalledWith("workspace", { opportunityIds: [id], includeHistory: false });
    const request = mocks.parse.mock.calls[0][0];
    expect(request.store).toBe(false);
    expect(request.text.format.type).toBe("json_schema");
    expect(request.input[1].content).toContain("Europe/London");
    expect(request.input[1].content).toContain("task alone");
    expect(request.input[1].content).toContain(snapshot.activityTypes[0].name);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.spoken_draft_generated" }));
  });
  it("guides missing AI setup without making a provider request", async () => {
    mocks.env.OPENAI_API_KEY = "";
    const result = await parseSpokenCrmDraftAction({ kind: "opportunity", transcript: "A new website" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("OpenAI connection") });
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("does not prepare an update for a record outside the workspace", async () => {
    mocks.snapshot.mockResolvedValue({ ...demoBoardForEdition("service"), opportunities: [] });
    const result = await parseSpokenCrmDraftAction({ kind: "activity_update", opportunityId: "00000000-0000-4000-8000-000000000099", transcript: "Log this call" });
    expect(result.ok).toBe(false);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects an invalid timezone before contacting the provider", async () => {
    const result = await parseSpokenCrmDraftAction({ kind: "activity_update", timezone: "not-a-zone", transcript: "Log this call" });
    expect(result.ok).toBe(false);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
