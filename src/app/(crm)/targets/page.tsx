import { ResearchHub } from "@/components/research-hub";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getFreeMaxStatus } from "@/lib/enrichment/usage";
import { getCurrentMember } from "@/lib/session";

export default async function TargetsPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const [snapshot, freeMaxStatus] = await Promise.all([
    getBoardSnapshot(member.organisationId),
    getFreeMaxStatus(member.organisationId, member.storageMode),
  ]);
  return <ResearchHub snapshot={snapshot} freeMaxStatus={freeMaxStatus} view="accounts" canManage={member.role === "admin"} />;
}
