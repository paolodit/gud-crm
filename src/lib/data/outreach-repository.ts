import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { contacts } from "@/db/schema";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getLocalBoardSnapshot } from "@/lib/data/local-store";
import { outreachCandidate, suppressedPhones } from "@/lib/domain/outreach";
import type { CurrentMember } from "@/lib/session";

async function getSuppressedNumbers(member: CurrentMember) {
  const records = member.storageMode === "sqlite"
    ? getLocalBoardSnapshot().opportunities.flatMap((item) => item.contacts)
    : await db.select({ phone: contacts.phone, doNotContact: contacts.doNotContact }).from(contacts)
      .where(and(eq(contacts.organisationId, member.organisationId), eq(contacts.doNotContact, true)));
  return new Set(suppressedPhones(records));
}

export async function getOutreachList(member: CurrentMember) {
  const [snapshot, suppressed] = await Promise.all([
    getBoardSnapshot(member.organisationId, { includeHistory: false }),
    getSuppressedNumbers(member),
  ]);
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const candidates = snapshot.opportunities
    .map((item) => outreachCandidate(item, stages.get(item.stageId), suppressed))
    .filter((item) => item !== null)
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.title.localeCompare(b.title));
  return { candidates, phoneActivityAvailable: snapshot.activityTypes.some((type) => type.channel === "phone") };
}

export async function prepareOutreachNumber(member: CurrentMember, opportunityId: string, contactId: string | null, number: string) {
  const [snapshot, suppressed] = await Promise.all([
    getBoardSnapshot(member.organisationId, { opportunityIds: [opportunityId] }),
    getSuppressedNumbers(member),
  ]);
  const item = snapshot.opportunities[0];
  if (!item) return null;
  const candidate = outreachCandidate(item, snapshot.stages.find((stage) => stage.id === item.stageId), suppressed);
  if (!candidate?.numbers.some((option) => option.dial === number && option.contactId === (contactId ?? "switchboard"))) return null;
  const latest = item.activities[0];
  return { lastActivity: latest ? { at: latest.occurredAt, notes: latest.notes, outcome: latest.outcome } : null };
}
