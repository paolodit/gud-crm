// Shared allowlist for the Realtime API and the browser's Options menu.
export const gudVoices = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export type GudVoice = typeof gudVoices[number];
export type VoicePreferences = { conversationFirst: boolean; voice: GudVoice; consent: boolean; pace: "quick" | "relaxed" };
export const defaultVoicePreferences: VoicePreferences = { conversationFirst: true, voice: "marin", consent: false, pace: "quick" };

export function readVoicePreferences(raw: string | null): VoicePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      conversationFirst: typeof value?.conversationFirst === "boolean" ? value.conversationFirst : true,
      voice: gudVoices.includes(value?.voice) ? value.voice : "marin",
      pace: value?.pace === "relaxed" ? "relaxed" : "quick",
      // Only an explicit, versioned opt-in is remembered, never a truthy string.
      consent: value?.consentVersion === 1 && value?.consent === true,
    };
  } catch { return { ...defaultVoicePreferences }; }
}

/** A local revocation must win over an older cookie, even when its request failed. */
export function latestVoicePreferences(cookie: string | null, local: string | null) {
  const time = (raw: string | null) => { try { const t = JSON.parse(raw ?? "null")?.updatedAt; return typeof t === "number" && Number.isFinite(t) ? t : 0; } catch { return 0; } };
  return readVoicePreferences(cookie && (!local || time(cookie) >= time(local)) ? cookie : local);
}
