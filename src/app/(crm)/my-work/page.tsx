import { MyWork } from "@/components/my-work";
import { getSalesBoardSnapshot } from "@/lib/data/board-selectors";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";

export default async function MyWorkPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const snapshot = getSalesBoardSnapshot(await getBoardSnapshot(member.organisationId));
  return <MyWork initialSnapshot={snapshot} memberId={member.id} memberName={member.name} />;
}
