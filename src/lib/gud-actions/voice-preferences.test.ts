import { describe, expect, it } from "vitest";
import { defaultVoicePreferences, gudVoices, latestVoicePreferences, readVoicePreferences } from "./voice-preferences";

describe("conversation options", () => {
  it("defaults to conversation first without assuming consent", () => {
    expect(readVoicePreferences(null)).toEqual(defaultVoicePreferences);
    expect(readVoicePreferences("broken")).toEqual(defaultVoicePreferences);
  });
  it("remembers a valid voice, explicit opt-out and versioned consent", () => {
    for (const voice of gudVoices) expect(readVoicePreferences(JSON.stringify({ voice, conversationFirst: false, consent: true, consentVersion: 1 }))).toEqual({ voice, conversationFirst: false, consent: true, pace: "quick" });
  });
  it("rejects unknown voices, old consent and truthy strings", () => {
    expect(readVoicePreferences(JSON.stringify({ voice: "unknown", conversationFirst: "false", consent: "true", consentVersion: 1 }))).toEqual(defaultVoicePreferences);
    expect(readVoicePreferences(JSON.stringify({ consent: true })).consent).toBe(false);
    expect(readVoicePreferences(JSON.stringify({ consent: true, consentVersion: 2 })).consent).toBe(false);
  });
  it("restores cookie consent without localStorage, but honours a newer local revocation", () => {
    const cookie = JSON.stringify({ consent: true, consentVersion: 1, updatedAt: 100, pace: "relaxed" });
    expect(latestVoicePreferences(cookie, null)).toMatchObject({ consent: true, pace: "relaxed" });
    expect(latestVoicePreferences(cookie, JSON.stringify({ consent: false, consentVersion: 1, updatedAt: 101 })).consent).toBe(false);
    expect(latestVoicePreferences(cookie, "broken").consent).toBe(true);
    expect(latestVoicePreferences(null, JSON.stringify({ consent: true, consentVersion: 1 })).consent).toBe(true);
  });
});
