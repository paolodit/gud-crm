import { GlobalSearch } from "@/components/crm-views";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";

export default async function SearchPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  return <GlobalSearch snapshot={await getBoardSnapshot(member.organisationId)} />;
}
