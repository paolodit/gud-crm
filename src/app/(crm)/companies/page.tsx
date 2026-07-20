import { CompaniesDirectory } from "@/components/crm-views";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";

export default async function CompaniesPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  return <CompaniesDirectory snapshot={await getBoardSnapshot(member.organisationId)} />;
}
