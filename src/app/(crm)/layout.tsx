import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { outreachEnabled } from "@/lib/data/outreach-settings";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect("/sign-in");

  return <AppShell member={member} instanceName={env.instanceName} showOutreach={await outreachEnabled(member)}>{children}</AppShell>;
}
