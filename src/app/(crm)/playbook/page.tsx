import { PlaybookWorkspace } from "@/components/crm-views";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getSalesAssets } from "@/lib/data/workspace-repository";
import { activeOffers, defaultOffer } from "@/lib/domain/offers";
import { getCurrentMember } from "@/lib/session";

export default async function PlaybookPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const snapshot = await getBoardSnapshot(member.organisationId);
  const offers = activeOffers(snapshot.offers);
  const fallback = defaultOffer(snapshot.offers);
  const entries = await Promise.all(offers.map(async (offer) => [
    offer.id,
    await getSalesAssets(member.organisationId, member.storageMode, offer.id, offer.id === fallback?.id),
  ] as const));
  return <PlaybookWorkspace offers={offers} assetsByOffer={Object.fromEntries(entries)} canManageAssets={member.role !== "member"} />;
}
