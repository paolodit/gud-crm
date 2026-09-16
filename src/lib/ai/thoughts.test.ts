import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mock.create }; } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/data/local-store", () => ({ getLocalAiEnabled: () => true }));
vi.mock("@/lib/env", () => ({ env: { AI_MODEL: "test-model", OPENAI_API_KEY: "fixture", AI_TIMEOUT_MS: 1000 } }));
import { generateThoughtExploration, thoughtOutline } from "./thoughts";
import type { Thought } from "@/lib/domain/thoughts";
const note: Thought = { id: "private-id", title: "One idea", body: "A community studio", checklist: [], colour: "sage", category: "Private category", x: 120, y: 40, version: 2, archived: false, createdAt: "now", updatedAt: "now" };
beforeEach(() => { mock.create.mockReset(); mock.create.mockResolvedValue({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "A claim [1]", annotations: [{ type: "url_citation", url: "https://example.com/source", title: "Source", start_index: 8, end_index: 11 }] }] }] }); });
describe("private AI exploration", () => {
  it("only sends the chosen thought, disables response storage and does not search by default", async () => {
    const result = await generateThoughtExploration(note, false);
    const request = mock.create.mock.calls[0][0];
    expect(request.store).toBe(false); expect(request.tools).toEqual([]);
    expect(JSON.parse(request.input[1].content)).toEqual({ title: note.title, text: note.body, checklist: [] });
    expect(JSON.stringify(request)).not.toContain("private-id"); expect(JSON.stringify(request)).not.toContain("Private category");
    expect(result.sources[0]).toMatchObject({ url: "https://example.com/source", start: 8, end: 11 });
  });
  it("only enables research when selected, preserves sources, and rejects truncated responses", async () => {
    await generateThoughtExploration(note, true);
    expect(mock.create.mock.calls[0][0].tools).toEqual([{ type: "web_search" }]);
    mock.create.mockResolvedValue({ status: "incomplete", output: [] });
    await expect(generateThoughtExploration(note, false)).rejects.toThrow("did not complete");
  });
  it("labels the offline path as a template, without inventing evidence", () => {
    const result = thoughtOutline(note);
    expect(result.body).toContain("not AI research"); expect(result.sources).toEqual([]); expect(mock.create).not.toHaveBeenCalled();
  });
});
