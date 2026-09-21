import { describe, expect, it } from "vitest";
import { nextThoughtPosition } from "./thought-placement";
describe("graceful thought placement", () => {
  it("fills a nearby gap below short measured cards instead of a distant fixed row", () => {
    expect(nextThoughtPosition([{ x: 32, y: 32, height: 130, archived: false }], { x: 32, y: 32 }, 1)).toEqual({ x: 32, y: 182 });
  });
  it("avoids freely positioned notes and ignores archives", () => {
    expect(nextThoughtPosition([{ x: 50, y: 40, archived: false }])).toEqual({ x: 362, y: 32 });
    expect(nextThoughtPosition([{ x: 32, y: 32, archived: true }])).toEqual({ x: 32, y: 32 });
  });
  it("fills rows within the available viewport and never moves existing notes", () => {
    const notes: Array<{ x: number; y: number; archived: boolean }> = [];
    for (let i = 0; i < 8; i++) notes.push({ ...nextThoughtPosition(notes, { x: 32, y: 32 }, 2), archived: false });
    expect(notes[2]).toEqual({ x: 32, y: 452, archived: false });
    expect(new Set(notes.map(n => `${n.x}:${n.y}`)).size).toBe(8);
  });
});
