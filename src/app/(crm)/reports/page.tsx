import { ReportsDashboard } from "@/components/crm-views";
import { getSalesBoardSnapshot } from "@/lib/data/board-selectors";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";

export default async function ReportsPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  return <ReportsDashboard snapshot={getSalesBoardSnapshot(await getBoardSnapshot(member.organisationId))} />;
}
