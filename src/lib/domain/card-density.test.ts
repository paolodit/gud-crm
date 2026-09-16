import { describe, expect, it } from "vitest";
import { cardDensityKey, isCompactDensity } from "./card-density";

describe("remembered card density", () => {
  it("isolates page, user and organisation preferences", () => {
    const keys = [
      cardDensityKey("org-a:alice", "pipeline"),
      cardDensityKey("org-a:alice", "live"),
      cardDensityKey("org-a:alice", "companies"),
      cardDensityKey("org-a:bob", "pipeline"),
      cardDensityKey("org-b:alice", "pipeline"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(cardDensityKey("org-a:alice", "pipeline")).toBe(keys[0]);
  });
  it("defaults to comfortable for missing or malformed storage values", () => {
    expect(isCompactDensity("compact")).toBe(true);
    for (const value of [null, "comfortable", "", "true", "broken-json"]) expect(isCompactDensity(value)).toBe(false);
  });
});
