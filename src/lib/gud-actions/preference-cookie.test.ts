import { beforeEach, describe, expect, it, vi } from "vitest";
const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { readVoicePreferenceCookie, voicePreferenceCookieName, writeVoicePreferenceCookie } from "./preference-cookie";
const actor = { id: "alice", organisationId: "org-one" };
const value = { consent: true, consentVersion: 1, conversationFirst: true, voice: "cedar", pace: "quick", updatedAt: 123 };
describe("remembered voice permission", () => {
  beforeEach(() => vi.clearAllMocks());
  it("scopes cookies to both account and workspace, without exposing their IDs", async () => {
    const key = voicePreferenceCookieName(actor);
    expect(key).not.toContain("alice");
    expect(key).not.toEqual(voicePreferenceCookieName({ ...actor, id: "bob" }));
    expect(key).not.toEqual(voicePreferenceCookieName({ ...actor, organisationId: "org-two" }));
    jar.get.mockReturnValue({ value: JSON.stringify(value) });
    expect(await readVoicePreferenceCookie(actor)).toBe(JSON.stringify(value));
    expect(jar.get).toHaveBeenCalledWith(key);
  });
  it("stores explicit permission and revocation securely for a year", async () => {
    await writeVoicePreferenceCookie(actor, value, true);
    expect(jar.set).toHaveBeenCalledWith(voicePreferenceCookieName(actor), expect.any(String), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 31536000 });
    expect(JSON.parse(jar.set.mock.calls[0][1])).toEqual(value);
    await writeVoicePreferenceCookie(actor, { ...value, consent: false }, true);
    expect(JSON.parse(jar.set.mock.calls.at(-1)![1]).consent).toBe(false);
  });
  it("rejects stale consent formats, identity fields, and invalid choices", async () => {
    for (const bad of [{ ...value, consentVersion: 0 }, { ...value, consent: "true" }, { ...value, actorId: "bob" }, { ...value, voice: "unknown" }]) await expect(writeVoicePreferenceCookie(actor, bad, true)).rejects.toThrow();
    expect(jar.set).not.toHaveBeenCalled();
  });
});
