import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/db";
import { auditEvents, companies, contacts, offers, opportunities, stages } from "@/db/schema";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getLocalBoardSnapshot, recordLocalAuditEvent, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import { lockOutreachEnabled } from "@/lib/data/outreach-settings";
import { extractDomain } from "@/lib/domain/normalise";
import { isOutreachStage, outreachCandidate, suppressedPhones, type outreachContactDetailsSchema } from "@/lib/domain/outreach";
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

export async function getOutreachLookupCompany(member: CurrentMember, opportunityId: string) {
  const snapshot = await getBoardSnapshot(member.organisationId, { opportunityIds: [opportunityId], includeHistory: false });
  const item = snapshot.opportunities[0];
  if (!item || !outreachCandidate(item, snapshot.stages.find((stage) => stage.id === item.stageId), [])) return null;
  return { name: item.company.name, websiteUrl: item.company.websiteUrl };
}

export async function saveOutreachContactDetails(member: CurrentMember, data: z.infer<typeof outreachContactDetailsSchema>) {
  const { opportunityId, websiteUrl, switchboardPhone } = data;
  const detail = { opportunityId, websiteChanged: websiteUrl !== undefined, phoneChanged: switchboardPhone !== undefined };
  if (member.storageMode === "sqlite") {
    return updateLocalBoardSnapshot((snapshot) => {
      const item = snapshot.opportunities.find((opportunity) => opportunity.id === opportunityId);
      if (!item || !outreachCandidate(item, snapshot.stages.find((stage) => stage.id === item.stageId), [])) return false;
      for (const opportunity of snapshot.opportunities) {
        if (opportunity.company.id !== item.company.id) continue;
        if (websiteUrl !== undefined) opportunity.company.websiteUrl = websiteUrl || null;
        if (switchboardPhone !== undefined) opportunity.company.switchboardPhone = switchboardPhone || null;
      }
      recordLocalAuditEvent({ actorId: member.id, action: "outreach.contact_details.updated", entityType: "company", entityId: item.company.id, detail });
      return true;
    });
  }
  return db.transaction(async (tx) => {
    if (!await lockOutreachEnabled(tx, member.organisationId)) return false;
    const [record] = await tx.select({ companyId: companies.id, name: stages.name, terminalType: stages.terminalType })
      .from(opportunities)
      .innerJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.organisationId, member.organisationId)))
      .innerJoin(stages, and(eq(stages.id, opportunities.stageId), eq(stages.pipelineId, opportunities.pipelineId), eq(stages.active, true)))
      .leftJoin(offers, and(eq(offers.id, opportunities.offerId), eq(offers.organisationId, member.organisationId)))
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organisationId, member.organisationId),
        isNull(opportunities.archivedAt), isNull(companies.archivedAt), eq(companies.doNotContact, false),
        or(isNull(opportunities.offerId), eq(offers.active, true))))
      .for("update", { of: companies });
    if (!record || !isOutreachStage(record)) return false;
    const domain = websiteUrl === undefined ? undefined : extractDomain(websiteUrl);
    await tx.update(companies).set({
      websiteUrl: websiteUrl === "" ? null : websiteUrl,
      domain,
      normalisedDomain: domain,
      importMetadata: switchboardPhone === undefined ? undefined
        : sql`COALESCE(${companies.importMetadata}, '{}'::jsonb) || ${JSON.stringify({ switchboardPhone: switchboardPhone || null })}::jsonb`,
      updatedAt: new Date(),
    }).where(and(eq(companies.id, record.companyId), eq(companies.organisationId, member.organisationId)));
    await tx.insert(auditEvents).values({
      organisationId: member.organisationId, actorId: member.id, action: "outreach.contact_details.updated",
      entityType: "company", entityId: record.companyId, after: detail,
    });
    return true;
  });
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
