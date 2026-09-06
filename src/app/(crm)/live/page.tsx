import { LiveBoard } from "@/components/live-board";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";

export default async function LivePage() {
  const member = await getCurrentMember();
  if (!member) return null;
  return <LiveBoard snapshot={await getBoardSnapshot(member.organisationId, { includeHistory: false })} />;
}
