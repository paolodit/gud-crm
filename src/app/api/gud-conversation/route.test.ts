import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), actor: vi.fn(), commit: vi.fn(), load: vi.fn(), refs: vi.fn(), voice: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://fixture.test" } }));
vi.mock("@/lib/session", () => ({ getCurrentMember: mocks.member }));
vi.mock("@/lib/gud-actions/service", () => ({ assertConversationActor: mocks.actor, listDrafts: mocks.load, actionReferences: mocks.refs, commitDrafts: mocks.commit }));
vi.mock("@/lib/gud-actions/conversation", async () => {
  const { z } = await import("zod");
  return { contextSchema: z.object({}), connectRealtime: mocks.voice, safeConversationError: () => "GUD could not complete this request. Nothing was saved." };
});
import { POST } from "./route";
const actor = { id: "fixture-actor", organisationId: "fixture-org" };
const request = (body: unknown, origin: string | null = "https://fixture.test") => new Request("https://fixture.test/api/gud-conversation", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
describe("conversation HTTP boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue(actor); mocks.actor.mockReturnValue(undefined); mocks.load.mockResolvedValue([]); mocks.refs.mockResolvedValue({}); mocks.commit.mockResolvedValue([]); });
  it("rejects missing/foreign origins before reading credentials or invoking actions", async () => {
    expect((await POST(request({ op: "load" }, null))).status).toBe(403);
    expect((await POST(request({ op: "load" }, "https://other.test"))).status).toBe(403);
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("requires authentication and blocks impersonation/disabled actors", async () => {
    mocks.member.mockResolvedValueOnce(null);
    expect((await POST(request({ op: "load" }))).status).toBe(401);
    mocks.actor.mockImplementationOnce(() => { throw new Error("disabled actor"); });
    expect((await POST(request({ op: "load" }))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejects extra actor/organisation fields, invalid JSON and oversized input", async () => {
    expect((await POST(request({ op: "save", input: [], actorId: "someone-else" }))).status).toBe(400);
    expect((await POST(request("invalid-json"))).status).toBe(400);
    expect((await POST(request("x".repeat(100001)))).status).toBe(413);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("passes explicit reviewed versions with the authenticated actor, never model identity", async () => {
    const input = [{ id: crypto.randomUUID(), version: 2 }];
    expect((await POST(request({ op: "save", input }))).status).toBe(200);
    expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(actor, input);
  });
  it("never leaks provider/database exception text", async () => {
    mocks.commit.mockRejectedValueOnce(new Error("private-database-detail-or-api-key"));
    const response = await POST(request({ op: "save", input: [] }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-database-detail-or-api-key");
  });
  it("validates voice choices server-side and retains the existing default", async () => {
    mocks.voice.mockResolvedValue({ sdp: "fixture-answer" });
    const sessionId = crypto.randomUUID(), input = { sdp: "fixture-offer", context: {} };
    expect((await POST(request({ op: "voice", sessionId, input: { ...input, voice: "cedar" } }))).status).toBe(200);
    expect(mocks.voice).toHaveBeenLastCalledWith(actor, sessionId, input.sdp, {}, "cedar");
    expect((await POST(request({ op: "voice", sessionId, input }))).status).toBe(200);
    expect(mocks.voice).toHaveBeenLastCalledWith(actor, sessionId, input.sdp, {}, "marin");
    expect((await POST(request({ op: "voice", sessionId, input: { ...input, voice: "not-a-voice" } }))).status).toBe(400);
    expect(mocks.voice).toHaveBeenCalledTimes(2);
  });
});
