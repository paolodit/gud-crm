import { describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { voiceContextFromSnapshot } from "@/lib/data/voice-workspace-repository";
import { changesFromVoiceInterpretation, interpretWorkspaceVoice, voiceInterpretationSchema } from "./voice-workspace";

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { parse: mocks.parse }; } }));
vi.mock("@/lib/env", () => ({ env: { AI_MODEL: "configured-model", OPENAI_API_KEY: "test-placeholder", AI_TIMEOUT_MS: 1000 } }));
const empty = Object.fromEntries(Object.keys(voiceInterpretationSchema.shape).map((key) => [key, null]));
const now = new Date("2026-09-10T10:00:00.000Z");

describe("workspace voice interpretation", () => {
  it("keeps a date-only next action incomplete instead of inventing a time", () => {
    const result = changesFromVoiceInterpretation({ ...empty, task: { title: "Send the outline", dueDate: "2026-09-11", dueTime: null } }, "Europe/London", now);
    expect(result.changes).toEqual({ task: { title: "Send the outline", dueAt: null } });
    expect(result.taskDateHint).toBe("2026-09-11");
  });
  it("converts the user timezone and defaults only an unstated activity recording time", () => {
    const result = changesFromVoiceInterpretation({ ...empty, activity: { typeId: crypto.randomUUID(), notes: "We spoke", outcome: null, occurredLocal: null }, task: { title: "Send the outline", dueDate: "2026-09-11", dueTime: "10:00" }, deliveryValue: 0 }, "Europe/London", now);
    expect(result.changes?.activity?.occurredAt).toBe(now.toISOString());
    expect(result.changes?.task?.dueAt).toBe("2026-09-11T09:00:00.000Z");
    expect(result.changes?.deliveryValue).toBe(0);
  });
  it("returns clarification without a partial mutation", () => {
    expect(changesFromVoiceInterpretation({ ...empty, clarification: "Which client did you mean?", salesValue: 10 }, "Europe/London", now)).toEqual({ clarification: "Which client did you mean?", changes: null, taskDateHint: null });
  });
  it("rejects invalid amounts, malformed dates and future activities", () => {
    expect(() => changesFromVoiceInterpretation({ ...empty, salesValue: -1 }, "Europe/London", now)).toThrow();
    expect(() => changesFromVoiceInterpretation({ ...empty, task: { title: "Next move", dueDate: "2026-02-31", dueTime: "10:00" } }, "Europe/London", now)).toThrow();
    expect(() => changesFromVoiceInterpretation({ ...empty, activity: { typeId: crypto.randomUUID(), notes: "A future meeting", outcome: null, occurredLocal: "2026-09-11T10:00" } }, "Europe/London", now)).toThrow("already have happened");
  });
  it("uses the configured model and no stored response, sending only minimal record context", async () => {
    const snapshot = demoBoardForEdition("service");
    const context = voiceContextFromSnapshot(snapshot, { kind: "sales", id: snapshot.opportunities[0].id });
    mocks.parse.mockResolvedValue({ output_parsed: { ...empty, temperature: "warm" } });
    await interpretWorkspaceVoice("They said the timing is warm", context, "Europe/London");
    const request = mocks.parse.mock.calls.at(-1)![0];
    expect(request.model).toBe("configured-model");
    expect(request.store).toBe(false);
    expect(request.text.format.schema.required).toContain("clarification");
    const reference = JSON.parse(request.input[1].content).reference;
    expect(Object.keys(reference)).toEqual(["selected", "salesStages", "deliveryStages", "activityTypes"]);
    expect(reference).not.toHaveProperty("activities");
    expect(reference).not.toHaveProperty("contacts");
    expect(request.input[0].content).toContain("Never silently apply a subset");
  });
});
