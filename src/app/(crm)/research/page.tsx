import { ResearchHub } from "@/components/research-hub";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getFreeMaxStatus } from "@/lib/enrichment/usage";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";

export default async function ResearchPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const [snapshot, freeMaxStatus] = await Promise.all([
    getBoardSnapshot(member.organisationId),
    getFreeMaxStatus(member.organisationId, member.storageMode),
  ]);
  return <ResearchHub snapshot={snapshot} freeMaxStatus={freeMaxStatus} view="themes" canManage={member.role === "admin"} voiceAiConfigured={env.aiEnabled && env.AI_PROVIDER === "openai" && Boolean(env.OPENAI_API_KEY)} />;
}
