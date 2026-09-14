import { describe, expect, it } from "vitest";
import { voiceChoicesForScope, voiceScopeForPath, voiceScopeForTarget, type VoiceChoice } from "./voice-workspace";

const choices: VoiceChoice[] = [
  { target: { id: "one", kind: "sales" }, companyName: "Same client", title: "Sales record" },
  { target: { id: "one", kind: "delivery" }, companyName: "Same client", title: "Delivery record" },
  { target: { id: "two", kind: "direct" }, companyName: "Other client", title: "Standalone project" },
];
describe("context-sensitive voice record picker", () => {
  it("defaults to the current page while keeping other pages global", () => {
    expect(voiceScopeForPath("/live")).toBe("delivery");
    expect(voiceScopeForPath("/pipeline")).toBe("sales");
    expect(voiceScopeForPath("/targets")).toBe("sales");
    expect(voiceScopeForPath("/my-work")).toBe("all");
  });
  it("includes direct and sales-linked projects, never their sales twin", () => {
    expect(voiceChoicesForScope(choices, "delivery").map((choice) => choice.target.kind)).toEqual(["delivery", "direct"]);
    expect(voiceChoicesForScope(choices, "sales")).toEqual([choices[0]]);
    expect(voiceScopeForTarget(choices[2].target)).toBe("delivery");
  });
  it("searches within the selected scope and handles empty results", () => {
    expect(voiceChoicesForScope(choices, "delivery", " SAME ")).toEqual([choices[1]]);
    expect(voiceChoicesForScope(choices, "sales", "Standalone")).toEqual([]);
    expect(voiceChoicesForScope(choices, "all")).toEqual(choices);
  });
});
