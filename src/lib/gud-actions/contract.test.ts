import { describe, expect, it } from "vitest";
import { actionTools, assertFieldScope, draftInputSchema, fieldsSchema, invalidActionMessage, recordHref, signOff, toolArguments } from "./contract";

describe("GUD action contract", () => {
  it("exposes marketing, targets, reports and guides without arbitrary browser execution", () => {
    for (const screen of ["marketing", "targets", "reports", "guides"]) expect(() => toolArguments.navigate.parse({ screen })).not.toThrow();
    expect(() => toolArguments.page_control.parse({ page: "/reports", action: "eval", value: "fetch('/secret')" })).toThrow();
    expect(() => assertFieldScope({ kind: "idea", timezone: "Europe/London", fields: { title: "Hotel campaigns", problem: "Empty rooms", angle: "New booking service", clearOffer: true } })).not.toThrow();
    expect(() => assertFieldScope({ kind: "target", timezone: "Europe/London", fields: { researchThemeIds: [crypto.randomUUID()] } })).not.toThrow();
    expect(() => assertFieldScope({ kind: "idea", timezone: "Europe/London", fields: { body: "Private thought" } })).toThrow();
  });
  it("exposes bounded actions with independently guarded saving, never arbitrary execution", () => {
    expect(actionTools.map(t => t.name)).toEqual(["navigate", "search", "open_record", "stage_change", "revise_draft", "save_changes", "page_control", "close_record", "finish_conversation"]);
    expect(() => toolArguments.navigate.parse({ screen: "https://evil.test" })).toThrow();
    expect(() => fieldsSchema.parse({ sql: "UPDATE users" })).toThrow();
  });
  it("keeps amounts, identity and timezones bounded", () => {
    expect(() => fieldsSchema.parse({ value: -1 })).toThrow();
    expect(() => fieldsSchema.parse({ dueTime: "25:30" })).toThrow();
    expect(() => draftInputSchema.parse({ kind: "lead", timezone: "Mars/Olympus", fields: {} })).toThrow();
    expect(recordHref({ kind: "project", id: "123" })).toBe("/live?project=123");
  });
  it("gives Thoughts private colours/categories/checklists but no shared CRM fields", () => {
    expect(() => assertFieldScope({ kind: "thought", timezone: "Europe/London", fields: { company: "Shared" } })).toThrow();
    expect(() => assertFieldScope({ kind: "thought", targetId: crypto.randomUUID(), timezone: "Europe/London", fields: { body: "Private", colour: "rose", category: "Video Ideas", addTasks: ["Sausages", "Potatoes", "Dog"] } })).not.toThrow();
  });
  it("signs off honestly instead of claiming unsaved work succeeded", () => {
    expect(signOff(true, 0)).toBe("Saved. All Gud.");
    expect(signOff(false, 0)).toBe("All Gud. Nothing changed.");
    expect(signOff(true, 1)).toContain("still in draft");
    expect(signOff(false, 2)).not.toContain("All Gud");
  });
  it.each([
    ["lead", { stageId: crypto.randomUUID() }],
    ["thought", { title: "Take Matteo shopping", addTasks: ["Go to shop 1", "Go to shop 2"] }],
    ["project", { nextMilestone: "Email 4" }],
  ])("accepts the %s partial update without 30 unrelated null fields", (kind, fields) => {
    const input = { kind, targetId: kind === "thought" ? null : crypto.randomUUID(), fields };
    expect(toolArguments.stage_change.parse(input).fields).toEqual(fields);
    expect(toolArguments.stage_change.parse({ ...input, draftId: null, version: null }).fields).toEqual(fields);
    expect(toolArguments.revise_draft.parse({ draftId: crypto.randomUUID(), version: 1, fields }).fields).toEqual(fields);
  });
  it("advertises optional patch fields and still accepts legacy null-filled calls", () => {
    const fields: Record<string, string | null> = Object.fromEntries(Object.keys(fieldsSchema.shape).map(key => [key, null]));
    fields.title = "A thought";
    expect(toolArguments.stage_change.parse({ kind: "thought", targetId: null, fields }).fields).toEqual(fields);
    const schema = actionTools.find(t => t.name === "stage_change")!.parameters;
    expect(schema.properties?.fields).not.toHaveProperty("required");
  });
  it("rejects missing targets, unknown fields and invalid supplied values", () => {
    for (const fields of [{ probability: 101 }, { stageId: "" }, { addTasks: [" "] }, { colour: "pink" }, { sql: "secret" }]) {
      expect(() => toolArguments.stage_change.parse({ kind: "thought", targetId: null, fields })).toThrow();
    }
    expect(() => toolArguments.stage_change.parse({ kind: "thought", fields: { title: "Missing explicit target" } })).toThrow();
    const result = toolArguments.stage_change.safeParse({ kind: "lead", targetId: null, fields: { probability: "private-value", "private-key": "secret" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = invalidActionMessage(result.error);
      expect(message).toContain("fields.probability");
      expect(message).not.toMatch(/private-value|private-key|secret/);
    }
  });
});
