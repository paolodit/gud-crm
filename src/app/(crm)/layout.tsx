import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";
import { readVoicePreferenceCookie } from "@/lib/gud-actions/preference-cookie";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect("/sign-in");

  const voicePreferences = await readVoicePreferenceCookie(member);
  return <AppShell member={member} instanceName={env.instanceName} voicePreferences={voicePreferences} conversationEnabled={env.GUD_CONVERSATION_ENABLED === "true" && member.storageMode === "postgres" && !member.impersonated}>{children}</AppShell>;
}
