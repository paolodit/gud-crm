import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ member: vi.fn(), save: vi.fn(), list: vi.fn(), explorations: vi.fn(), enabled: vi.fn(), get: vi.fn(), reserve: vi.fn(), generate: vi.fn(), append: vi.fn(), env: { publicDemo: false } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentMember: mock.member }));
vi.mock("@/lib/env", () => ({ env: mock.env }));
vi.mock("@/lib/data/thoughts-repository", () => ({ saveThought: mock.save, listThoughts: mock.list, listThoughtExplorations: mock.explorations, getThought: mock.get, reserveThoughtExploration: mock.reserve, appendThoughtExploration: mock.append }));
vi.mock("@/lib/ai/thoughts", () => ({ thoughtsAiEnabled: mock.enabled, generateThoughtExploration: mock.generate, thoughtOutline: () => ({ title: "Outline", body: "Template", sources: [] }) }));
import { exploreThoughtAction, loadThoughtsAction, saveThoughtAction } from "./thoughts";
const actor = { id: "alice", organisationId: "00000000-0000-4000-8000-000000000001", storageMode: "postgres", demoMode: false };
const thoughtId = "00000000-0000-4000-8000-000000000003";
beforeEach(() => { vi.clearAllMocks(); mock.env.publicDemo = false; mock.member.mockResolvedValue(actor); mock.list.mockResolvedValue([]); mock.explorations.mockResolvedValue([]); mock.enabled.mockResolvedValue(true); mock.reserve.mockResolvedValue(true); mock.get.mockResolvedValue({ id: thoughtId, version: 1, title: "Private thought" }); mock.generate.mockResolvedValue({ title: "Exploration", body: "Text", sources: [] }); mock.append.mockResolvedValue({ id: "exploration" }); });
describe("Thoughts action authentication", () => {
  it.each([null, { ...actor, demoMode: true }, { ...actor, impersonated: true }])("rejects an unsafe session before any storage access", async (member) => {
    mock.member.mockResolvedValue(member);
    expect((await loadThoughtsAction()).ok).toBe(false);
    expect((await saveThoughtAction({ content: { body: "Private" } })).ok).toBe(false);
    expect((await exploreThoughtAction({ id: thoughtId, mode: "ai" })).ok).toBe(false);
    expect(mock.list).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.get).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });
  it.each(["admin", "manager", "member"])("allows a public demo %s account with the same session ownership", async (role) => {
    mock.env.publicDemo = true;
    const member = { ...actor, role }; mock.member.mockResolvedValue(member);
    expect(await loadThoughtsAction()).toMatchObject({ ok: true, publicDemo: true });
    expect(mock.list).toHaveBeenCalledWith(member);
    expect((await saveThoughtAction({ content: { body: "Demo thought" } })).ok).toBe(true);
    expect(mock.save).toHaveBeenCalledWith(member, { content: { body: "Demo thought" } });
  });
  it("derives the owner exclusively from the authenticated session", async () => {
    await saveThoughtAction({ content: { body: "Note" } });
    expect(mock.save).toHaveBeenCalledWith(actor, { content: { body: "Note" } });
  });
  it("never sends outlines to AI and enforces configured AI plus rate limits", async () => {
    expect((await exploreThoughtAction({ id: thoughtId, mode: "outline" })).ok).toBe(true);
    expect(mock.generate).not.toHaveBeenCalled();
    mock.enabled.mockResolvedValue(false);
    expect((await exploreThoughtAction({ id: thoughtId, mode: "ai" })).ok).toBe(false);
    mock.enabled.mockResolvedValue(true); mock.reserve.mockResolvedValue(false);
    expect((await exploreThoughtAction({ id: thoughtId, mode: "ai" })).ok).toBe(false);
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it("does not expose provider or database error content", async () => {
    mock.generate.mockRejectedValue(new Error("secret private note in provider error"));
    const result = await exploreThoughtAction({ id: thoughtId, mode: "ai", research: false });
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("secret private");
    expect(mock.append).not.toHaveBeenCalled();
  });
  it("validates and passes bounded direction without changing the original thought", async () => {
    expect((await exploreThoughtAction({ id: thoughtId, mode: "ai", direction: " Compare options " })).ok).toBe(true);
    expect(mock.generate).toHaveBeenCalledWith(expect.objectContaining({ id: thoughtId }), false, "Compare options");
    expect(mock.save).not.toHaveBeenCalled();
    mock.generate.mockClear();
    expect((await exploreThoughtAction({ id: thoughtId, mode: "ai", direction: "x".repeat(4001) })).ok).toBe(false);
    expect(mock.generate).not.toHaveBeenCalled();
  });
});
