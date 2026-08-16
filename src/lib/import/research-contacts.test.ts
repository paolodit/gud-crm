import { describe, expect, it } from "vitest";

import { firstTargetMissingExplicitContacts, reconcileResearchContacts, type ResearchContactRecord } from "./research-contacts";

const ada: ResearchContactRecord = {
  id: "ada",
  name: "Ada Lovelace",
  title: "Operations Director",
  email: "ada@example.com",
  phone: "+44 20 7000 0001",
  linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
  preferredChannel: "email",
  doNotContact: true,
  sourceUrls: ["https://example.com/team"],
};

const grace: ResearchContactRecord = {
  id: "grace",
  name: "Grace Hopper",
  title: "Technical Director",
  email: "grace@example.com",
  phone: null,
  linkedinUrl: null,
  preferredChannel: "email",
  doNotContact: false,
  sourceUrls: [],
};

function reconcile(overrides: Partial<Parameters<typeof reconcileResearchContacts>[0]> = {}) {
  let created = 0;
  return reconcileResearchContacts({
    records: [ada, grace],
    associations: [{ contactId: ada.id, primary: true }, { contactId: grace.id, primary: false }],
    incoming: [],
    mode: "merge",
    createId: () => `new-${++created}`,
    ...overrides,
  });
}

describe("research contact reconciliation", () => {
  it("requires an explicit contacts array for every replace-mode target", () => {
    expect(firstTargetMissingExplicitContacts([{ name: "One", contacts: [] }, { name: "Two" }])).toBe(1);
    expect(firstTargetMissingExplicitContacts([{ name: "One", contacts: [] }, { name: "Two", contacts: [{}] }])).toBe(-1);
  });

  it("keeps every existing association in merge mode, including when contacts are omitted", () => {
    const result = reconcile({ incoming: [], mode: "merge" });
    expect(result.associations).toEqual([
      { contactId: "ada", primary: true },
      { contactId: "grace", primary: false },
    ]);
    expect(result.unlinkedIds).toEqual([]);
  });

  it("updates matches by email and unlinks omitted associations in replace mode", () => {
    const result = reconcile({
      mode: "replace",
      incoming: [{ name: "Ada L.", title: "COO", email: "ADA@example.com", sourceUrls: ["https://example.com/leadership"] }],
    });
    expect(result.updatedIds).toEqual(["ada"]);
    expect(result.unlinkedIds).toEqual(["grace"]);
    expect(result.associations).toEqual([{ contactId: "ada", primary: true }]);
    expect(result.records.find((contact) => contact.id === "ada")).toMatchObject({
      name: "Ada L.",
      title: "COO",
      phone: "+44 20 7000 0001",
      doNotContact: true,
      sourceUrls: ["https://example.com/team", "https://example.com/leadership"],
    });
  });

  it("treats an explicit empty list as authoritative and clears all associations", () => {
    const result = reconcile({ mode: "replace", incoming: [] });
    expect(result.associations).toEqual([]);
    expect(result.unlinkedIds).toEqual(["ada", "grace"]);
    expect(result.records).toHaveLength(2);
  });

  it("reassigns primary status when the previous primary is omitted", () => {
    const result = reconcile({
      mode: "replace",
      incoming: [{ name: "Grace Hopper", linkedinUrl: "https://www.linkedin.com/in/grace" }],
    });
    expect(result.unlinkedIds).toEqual(["ada"]);
    expect(result.associations).toEqual([{ contactId: "grace", primary: true }]);
  });

  it("matches LinkedIn URLs and normalised names before creating new records", () => {
    const linkedInMatch = reconcile({
      mode: "replace",
      incoming: [{ name: "Different display name", linkedinUrl: ada.linkedinUrl! }],
    });
    const nameMatch = reconcile({
      mode: "replace",
      incoming: [{ name: "  Grace---Hopper " }],
    });
    expect(linkedInMatch.updatedIds).toEqual(["ada"]);
    expect(nameMatch.updatedIds).toEqual(["grace"]);
    expect(linkedInMatch.createdIds).toEqual([]);
    expect(nameMatch.createdIds).toEqual([]);
  });

  it("creates supplied contacts and leaves another opportunity's shared link untouched", () => {
    const anotherOpportunity = [{ contactId: "grace", primary: true }];
    const result = reconcile({
      mode: "replace",
      incoming: [{ name: "Katherine Johnson", email: "katherine@example.com" }],
    });
    expect(result.createdIds).toEqual(["new-1"]);
    expect(result.unlinkedIds).toEqual(["ada", "grace"]);
    expect(result.associations).toEqual([{ contactId: "new-1", primary: true }]);
    expect(anotherOpportunity).toEqual([{ contactId: "grace", primary: true }]);
    expect(result.records.some((contact) => contact.id === "grace")).toBe(true);
  });

  it("scopes replacement to the supplied opportunity even when records are shared across offers", () => {
    const websiteOpportunity = [{ contactId: "ada", primary: true }, { contactId: "grace", primary: false }];
    const retainerOpportunity = [{ contactId: "grace", primary: true }];
    const websiteResult = reconcile({
      associations: websiteOpportunity,
      mode: "replace",
      incoming: [{ name: "Ada Lovelace" }],
    });
    expect(websiteResult.associations).toEqual([{ contactId: "ada", primary: true }]);
    expect(retainerOpportunity).toEqual([{ contactId: "grace", primary: true }]);
  });
});
