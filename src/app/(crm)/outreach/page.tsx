import { notFound } from "next/navigation";

import { OutreachWorkspace } from "@/components/outreach-workspace";
import { outreachAiEnabled } from "@/lib/ai/outreach";
import { getOutreachList } from "@/lib/data/outreach-repository";
import { canUseOutreach, getOutreachGuide, outreachEnabled } from "@/lib/data/outreach-settings";
import { getFreeMaxRuntimeConfiguration } from "@/lib/enrichment/config";
import { getCurrentMember } from "@/lib/session";
import "./outreach.css";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ opportunity?: string }> }) {
  const member = await getCurrentMember();
  if (!canUseOutreach(member) || !await outreachEnabled(member)) notFound();
  const [list, guide, aiEnabled, emailFinding, { opportunity }] = await Promise.all([
    getOutreachList(member), getOutreachGuide(member), outreachAiEnabled(member),
    getFreeMaxRuntimeConfiguration(member.organisationId, member.storageMode), searchParams,
  ]);
  return <OutreachWorkspace key={opportunity ?? "session"} {...list} {...guide} aiEnabled={aiEnabled}
    emailFindingConfigured={Boolean(emailFinding.keys.hunter || emailFinding.keys.norbert)} canEditGuide={member.role === "admin"}
    initialOpportunity={opportunity} storageKey={`gud-outreach:${member.organisationId}:${member.id}`} />;
}
