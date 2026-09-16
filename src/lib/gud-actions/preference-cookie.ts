import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { gudVoices } from "./voice-preferences";

type Owner = { id: string; organisationId: string };
export const voicePreferenceCookieName = (actor: Owner) => `gud-voice-${createHash("sha256").update(`${actor.organisationId}:${actor.id}`).digest("hex").slice(0, 24)}`;
export async function readVoicePreferenceCookie(actor: Owner) {
  return (await cookies()).get(voicePreferenceCookieName(actor))?.value ?? null;
}
export async function writeVoicePreferenceCookie(actor: Owner, input: unknown, secure: boolean) {
  const value = z.object({ conversationFirst: z.boolean(), voice: z.enum(gudVoices), consent: z.boolean(), consentVersion: z.literal(1), pace: z.enum(["quick", "relaxed"]), updatedAt: z.number().int().nonnegative() }).strict().parse(input);
  (await cookies()).set(voicePreferenceCookieName(actor), JSON.stringify(value), { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 365 * 24 * 60 * 60 });
}
