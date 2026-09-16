// Shared allowlist for the Realtime API and the browser's Options menu.
export const gudVoices = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export type GudVoice = typeof gudVoices[number];
export type VoicePreferences = { conversationFirst: boolean; voice: GudVoice; consent: boolean };
export const defaultVoicePreferences: VoicePreferences = { conversationFirst: true, voice: "marin", consent: false };

export function readVoicePreferences(raw: string | null): VoicePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      conversationFirst: typeof value?.conversationFirst === "boolean" ? value.conversationFirst : true,
      voice: gudVoices.includes(value?.voice) ? value.voice : "marin",
      // Only an explicit, versioned opt-in is remembered, never a truthy string.
      consent: value?.consentVersion === 1 && value?.consent === true,
    };
  } catch { return { ...defaultVoicePreferences }; }
}
