import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { parseSpokenCrmDraftAction } from "./ai";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), snapshot: vi.fn(), audit: vi.fn(), env: { aiEnabled: true, AI_PROVIDER: "openai", OPENAI_API_KEY: "test-placeholder", AI_MODEL: "test-model", AI_TIMEOUT_MS: 1000, AI_RATE_LIMIT: 10 } }));
vi.mock("openai", () => ({ default: class { responses = { parse: mocks.parse }; } }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/data/crm-repository", () => ({ getBoardSnapshot: mocks.snapshot }));
vi.mock("@/lib/session", () => ({ getCurrentMember: async () => ({ id: "user", organisationId: "workspace", name: "Alex", storageMode: "sqlite", demoMode: false }) }));
vi.mock("@/lib/data/local-store", () => ({ getLocalAiEnabled: () => true, consumeLocalAiRateLimit: () => true, recordLocalAuditEvent: mocks.audit }));
const fields = ["deliveryValue", "deliveryStage", "deliveryMilestone", "deliveryDueDate", "deliveryNotes", "companyName", "sector", "websiteUrl", "companyLinkedinUrl", "fitScore", "scaleNote", "researchNote", "title", "offerName", "ownerName", "priority", "temperature", "expectedValue", "probability", "expectedCloseDate", "outreachAngle", "contactName", "contactTitle", "contactEmail", "contactPhone", "contactLinkedinUrl", "nextActionTitle", "nextActionAt", "activityTypeName", "activityOutcome", "activityNotes", "activityOccurredAt"];
beforeEach(() => { vi.clearAllMocks(); mocks.env.OPENAI_API_KEY = "test-placeholder"; });

describe("voice drafting boundary", () => {
  it.each([12500.25, 0])("prepares explicitly spoken delivery value %s without changing sales value", async (deliveryValue) => {
    mocks.snapshot.mockResolvedValue(demoBoardForEdition("service"));
    mocks.parse.mockResolvedValue({ output_parsed: { ...Object.fromEntries(fields.map((name) => [name, null])), kind: "delivery_update", deliveryValue } });
    const result = await parseSpokenCrmDraftAction({ kind: "delivery_update", transcript: `The agreed project value is ${deliveryValue} pounds.` });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.draft.deliveryValue).toBe(deliveryValue); expect(result.draft.expectedValue).toBeNull(); }
    const request = mocks.parse.mock.calls[0][0];
    expect(request.store).toBe(false);
    expect(request.input[2].content).toContain("never infer it from a budget");
    expect(request.text.format.schema.required).toContain("deliveryValue");
  });
  it("rejects a negative delivery value from the provider", async () => {
    mocks.snapshot.mockResolvedValue(demoBoardForEdition("service"));
    mocks.parse.mockResolvedValue({ output_parsed: { ...Object.fromEntries(fields.map((name) => [name, null])), kind: "delivery_update", deliveryValue: -20 } });
    expect((await parseSpokenCrmDraftAction({ kind: "delivery_update", transcript: "Value minus twenty pounds" })).ok).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("prepares delivery fields with custom stage context and no CRM write", async () => {
    mocks.snapshot.mockResolvedValue({ ...demoBoardForEdition("service"), deliveryStages: [{ id: "qa", name: "Quality review", colour: "#123456", description: "" }] });
    mocks.parse.mockResolvedValue({ output_parsed: { ...Object.fromEntries(fields.map((name) => [name, null])), kind: "delivery_update", deliveryStage: "qa", deliveryNotes: "Draft ready", deliveryDueDate: "2026-10-16" } });
    const result = await parseSpokenCrmDraftAction({ kind: "delivery_update", transcript: "Move to Quality review. Draft ready. Due 16 October." });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.deliveryStage).toBe("qa");
    expect(mocks.parse.mock.calls[0][0].input[2].content).toContain("Quality review");
    expect(mocks.parse.mock.calls[0][0].input[2].content).toContain("Leave all sales, activity and task fields null");
  });
  it("rejects an invented delivery stage before returning a draft", async () => {
    mocks.snapshot.mockResolvedValue(demoBoardForEdition("service"));
    mocks.parse.mockResolvedValue({ output_parsed: { ...Object.fromEntries(fields.map((name) => [name, null])), kind: "delivery_update", deliveryStage: "nonexistent" } });
    expect((await parseSpokenCrmDraftAction({ kind: "delivery_update", transcript: "Move it ahead" })).ok).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
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
