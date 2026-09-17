import { describe, expect, it } from "vitest";
import { actionTools, assertFieldScope, draftInputSchema, fieldsSchema, recordHref, signOff, toolArguments } from "./contract";

describe("GUD action contract", () => {
  it("exposes bounded actions with independently guarded saving, never arbitrary execution", () => {
    expect(actionTools.map(t => t.name)).toEqual(["navigate", "search", "open_record", "stage_change", "revise_draft", "save_changes", "close_record", "finish_conversation"]);
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
});
