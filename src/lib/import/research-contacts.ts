import type { Channel } from "@/lib/domain/types";

export type ResearchContactImportMode = "merge" | "replace";

export type ResearchContactInput = {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  preferredChannel?: Channel | null;
  sourceUrls?: string[];
};

export type ResearchContactRecord = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  preferredChannel?: Channel | null;
  doNotContact: boolean;
  sourceUrls?: string[];
};

export type ResearchContactAssociation = {
  contactId: string;
  primary: boolean;
};

export type ResearchContactReconciliation = {
  records: ResearchContactRecord[];
  associations: ResearchContactAssociation[];
  createdIds: string[];
  updatedIds: string[];
  unlinkedIds: string[];
  primaryContactId: string | null;
};

export function firstTargetMissingExplicitContacts(targets: unknown[]) {
  return targets.findIndex((target) => !isObject(target) || !Object.hasOwn(target, "contacts") || !Array.isArray(target.contacts));
}

export function reconcileResearchContacts({
  records,
  associations,
  incoming,
  mode,
  createId,
}: {
  records: ResearchContactRecord[];
  associations: ResearchContactAssociation[];
  incoming: ResearchContactInput[];
  mode: ResearchContactImportMode;
  createId: () => string;
}): ResearchContactReconciliation {
  const nextRecords = records.map((contact) => ({ ...contact, sourceUrls: [...(contact.sourceUrls ?? [])] }));
  const desiredIds = mode === "merge" ? associations.map((association) => association.contactId) : [];
  const createdIds: string[] = [];
  const updatedIds = new Set<string>();

  for (const supplied of incoming) {
    let contact = nextRecords.find((candidate) => researchContactMatches(candidate, supplied));
    if (contact) {
      const merged = mergeResearchContact(contact, supplied);
      Object.assign(contact, merged);
      updatedIds.add(contact.id);
    } else {
      contact = {
        id: createId(),
        name: supplied.name,
        title: supplied.title || null,
        email: supplied.email || null,
        phone: supplied.phone || null,
        linkedinUrl: supplied.linkedinUrl || null,
        preferredChannel: supplied.preferredChannel ?? preferredChannelFor(supplied),
        doNotContact: false,
        sourceUrls: uniqueUrls(supplied.sourceUrls),
      };
      nextRecords.push(contact);
      createdIds.push(contact.id);
    }

    if (!desiredIds.includes(contact.id)) desiredIds.push(contact.id);
  }

  const unlinkedIds = mode === "replace"
    ? associations.map((association) => association.contactId).filter((contactId) => !desiredIds.includes(contactId))
    : [];
  const previousPrimary = associations.find((association) => association.primary)?.contactId ?? null;
  const primaryContactId = previousPrimary && desiredIds.includes(previousPrimary)
    ? previousPrimary
    : desiredIds[0] ?? null;

  return {
    records: nextRecords,
    associations: desiredIds.map((contactId) => ({ contactId, primary: contactId === primaryContactId })),
    createdIds,
    updatedIds: [...updatedIds].filter((contactId) => !createdIds.includes(contactId)),
    unlinkedIds,
    primaryContactId,
  };
}

export function researchContactMatches(existing: ResearchContactRecord, incoming: ResearchContactInput) {
  return Boolean(
    (incoming.email && existing.email?.toLowerCase() === incoming.email.toLowerCase()) ||
    (incoming.linkedinUrl && existing.linkedinUrl === incoming.linkedinUrl) ||
    normaliseName(existing.name) === normaliseName(incoming.name),
  );
}

function mergeResearchContact(existing: ResearchContactRecord, incoming: ResearchContactInput): ResearchContactRecord {
  return {
    ...existing,
    name: incoming.name || existing.name,
    title: incoming.title || existing.title,
    email: incoming.email || existing.email,
    phone: incoming.phone || existing.phone,
    linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
    preferredChannel: incoming.preferredChannel ?? existing.preferredChannel,
    sourceUrls: uniqueUrls(existing.sourceUrls, incoming.sourceUrls),
  };
}

function preferredChannelFor(contact: ResearchContactInput): Channel | null {
  if (contact.email) return "email";
  if (contact.phone) return "phone";
  if (contact.linkedinUrl) return "linkedin";
  return null;
}

function uniqueUrls(...collections: Array<string[] | undefined>) {
  return [...new Set(collections.flatMap((items) => items ?? []).filter(Boolean))];
}

function normaliseName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
