import { describe, expect, it } from "vitest";
import { defaultVoicePreferences, gudVoices, readVoicePreferences } from "./voice-preferences";

describe("conversation options", () => {
  it("defaults to conversation first without assuming consent", () => {
    expect(readVoicePreferences(null)).toEqual(defaultVoicePreferences);
    expect(readVoicePreferences("broken")).toEqual(defaultVoicePreferences);
  });
  it("remembers a valid voice, explicit opt-out and versioned consent", () => {
    for (const voice of gudVoices) expect(readVoicePreferences(JSON.stringify({ voice, conversationFirst: false, consent: true, consentVersion: 1 }))).toEqual({ voice, conversationFirst: false, consent: true });
  });
  it("rejects unknown voices, old consent and truthy strings", () => {
    expect(readVoicePreferences(JSON.stringify({ voice: "unknown", conversationFirst: "false", consent: "true", consentVersion: 1 }))).toEqual(defaultVoicePreferences);
    expect(readVoicePreferences(JSON.stringify({ consent: true })).consent).toBe(false);
    expect(readVoicePreferences(JSON.stringify({ consent: true, consentVersion: 2 })).consent).toBe(false);
  });
});
