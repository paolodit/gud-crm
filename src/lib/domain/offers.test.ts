import { describe, expect, it } from "vitest";

import { demoBoard } from "@/lib/demo-data";
import { activeOffers, contextualOffers, coreOffer, defaultOffer, hasMultipleOffers, migrateOffersInSnapshot } from "@/lib/domain/offers";
import type { BoardSnapshot, OfferSummary } from "@/lib/domain/types";

describe("offers", () => {
  it("keeps a single-offer workspace visually dormant", () => {
    expect(activeOffers([coreOffer])).toHaveLength(1);
    expect(defaultOffer([coreOffer])?.id).toBe(coreOffer.id);
    expect(hasMultipleOffers([coreOffer])).toBe(false);
  });

  it("recognises a genuine multi-offer workspace", () => {
    const second: OfferSummary = { ...coreOffer, id: crypto.randomUUID(), name: "Website projects", isDefault: false, position: 1 };
    expect(hasMultipleOffers([coreOffer, second])).toBe(true);
    expect(defaultOffer([coreOffer, second])?.id).toBe(coreOffer.id);
  });

  it("keeps an archived offer visible when historical records still reference it", () => {
    const archived: OfferSummary = { ...coreOffer, id: crypto.randomUUID(), name: "Archived service", isDefault: false, active: false, position: 1 };
    const historical = { ...demoBoard.opportunities[0], offer: archived };
    expect(contextualOffers([coreOffer, archived], [historical]).map((offer) => offer.id)).toEqual([coreOffer.id, archived.id]);
  });

  it("adds the default offer without changing existing CRM data", () => {
    const legacy = structuredClone(demoBoard);
    (legacy as unknown as { offers?: OfferSummary[] }).offers = undefined;
    for (const opportunity of legacy.opportunities) (opportunity as unknown as { offer?: OfferSummary }).offer = undefined;
    const before = {
      opportunities: legacy.opportunities.length,
      companies: legacy.opportunities.map((item) => item.company.id),
      contacts: legacy.opportunities.reduce((sum, item) => sum + item.contacts.length, 0),
      activities: legacy.opportunities.reduce((sum, item) => sum + item.activities.length, 0),
      users: legacy.users.map((user) => user.id),
    };

    const migrated = migrateOffersInSnapshot(legacy as BoardSnapshot);
    migrateOffersInSnapshot(migrated);

    expect(migrated.offers).toEqual([coreOffer]);
    expect(migrated.opportunities.every((item) => item.offer?.id === coreOffer.id)).toBe(true);
    expect({
      opportunities: migrated.opportunities.length,
      companies: migrated.opportunities.map((item) => item.company.id),
      contacts: migrated.opportunities.reduce((sum, item) => sum + item.contacts.length, 0),
      activities: migrated.opportunities.reduce((sum, item) => sum + item.activities.length, 0),
      users: migrated.users.map((user) => user.id),
    }).toEqual(before);
  });
});
