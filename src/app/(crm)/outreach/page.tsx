import { notFound } from "next/navigation";

import { OutreachWorkspace } from "@/components/outreach-workspace";
import { getOutreachList } from "@/lib/data/outreach-repository";
import { canUseOutreach, outreachEnabled } from "@/lib/data/outreach-settings";
import { getCurrentMember } from "@/lib/session";
import "./outreach.css";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ opportunity?: string }> }) {
  const member = await getCurrentMember();
  if (!canUseOutreach(member) || !await outreachEnabled(member)) notFound();
  const [list, { opportunity }] = await Promise.all([getOutreachList(member), searchParams]);
  return <OutreachWorkspace key={opportunity ?? "session"} {...list} initialOpportunity={opportunity} storageKey={`gud-outreach:${member.organisationId}:${member.id}`} />;
}
