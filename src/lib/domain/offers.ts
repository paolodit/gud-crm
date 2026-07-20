import type { BoardSnapshot, OfferSummary, OpportunitySummary } from "@/lib/domain/types";

export const CORE_OFFER_ID = "02000000-0000-4000-8000-000000000001";

export const coreOffer: OfferSummary = {
  id: CORE_OFFER_ID,
  name: "Core product",
  colour: "#6554C0",
  description: "The primary product or tightly connected product family this workspace sells.",
  idealCustomer: "Organisations with a clear operational problem, a credible owner and a reason to change.",
  positioning: "A focused product that makes an important recurring job simpler, clearer and easier to manage.",
  isDefault: true,
  active: true,
  position: 0,
};

export function activeOffers(offers: OfferSummary[]) {
  return offers.filter((offer) => offer.active).sort((a, b) => a.position - b.position);
}

export function defaultOffer(offers: OfferSummary[]) {
  const active = activeOffers(offers);
  return active.find((offer) => offer.isDefault) ?? active[0] ?? null;
}

export function hasMultipleOffers(offers: OfferSummary[]) {
  return activeOffers(offers).length > 1;
}

export function contextualOffers(offers: OfferSummary[], opportunities: OpportunitySummary[]) {
  const used = new Set(opportunities.flatMap((opportunity) => opportunity.offer ? [opportunity.offer.id] : []));
  return offers.filter((offer) => offer.active || used.has(offer.id)).sort((a, b) => a.position - b.position);
}

export function migrateOffersInSnapshot(snapshot: BoardSnapshot) {
  const existing = Array.isArray(snapshot.offers) ? snapshot.offers : [];
  if (existing.length === 0) snapshot.offers = [structuredClone(coreOffer)];
  const fallback = defaultOffer(snapshot.offers) ?? structuredClone(coreOffer);
  for (const opportunity of snapshot.opportunities) {
    if (!("offer" in opportunity) || opportunity.offer === undefined) {
      opportunity.offer = structuredClone(fallback);
    }
  }
  return snapshot;
}
