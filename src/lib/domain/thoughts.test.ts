import { describe, expect, it } from "vitest";
import { assertPrivateThoughtAccess, explorationDocumentSchema, thoughtContentSchema, thoughtFromSpeech } from "./thoughts";
describe("Thoughts boundaries", () => {
  it("blocks shared demos and impersonation", () => {
    for (const input of [{ demoMode: true }, { publicDemo: true }, { impersonated: true }]) expect(() => assertPrivateThoughtAccess(input)).toThrow();
    expect(() => assertPrivateThoughtAccess({})).not.toThrow();
  });
  it("requires content and rejects owner injection, unsafe links and out-of-range positions", () => {
    expect(thoughtContentSchema.safeParse({}).success).toBe(false);
    expect(thoughtContentSchema.safeParse({ body: "Idea", ownerId: "someone-else" }).success).toBe(false);
    expect(thoughtContentSchema.safeParse({ body: "Idea", x: -1 }).success).toBe(false);
    expect(explorationDocumentSchema.safeParse({ title: "Idea", body: "Text", sources: [{ title: "Bad", url: "javascript:alert(1)", start: 0, end: 1 }] }).success).toBe(false);
  });
  it("turns spoken bullets, checklist commands and explore-that into a reviewable draft", () => {
    const value = thoughtFromSpeech("Gud, new thought: a community studio. Bullet point: keep it affordable. To-do: talk to neighbours. Explore that");
    expect(value.body).toBe("a community studio.\n• keep it affordable.");
    expect(value.checklist).toEqual([expect.objectContaining({ text: "talk to neighbours.", done: false })]);
    expect(value.explore).toBe(true);
  });
});
