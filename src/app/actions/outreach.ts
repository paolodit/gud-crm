"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { draftOutreachCopy, lookUpOutreachSwitchboard, outreachAiEnabled, outreachLookupDomain, reserveOutreachAiRequest } from "@/lib/ai/outreach";
import { getOutreachLookupCompany, prepareOutreachNumber, saveOutreachContactDetails } from "@/lib/data/outreach-repository";
import { canUseOutreach, outreachEnabled, saveOutreachEnabled, saveOutreachGuide } from "@/lib/data/outreach-settings";
import { outreachContactDetailsSchema, outreachGuideSchema } from "@/lib/domain/outreach";
import { normaliseDialNumber } from "@/lib/domain/phone";
import { getCurrentMember } from "@/lib/session";

export async function saveOutreachSettingAction(value: unknown) {
  const enabled = z.boolean().safeParse(value);
  if (!enabled.success) return { ok: false, error: "Choose whether to enable Outreach." };
  if (!await saveOutreachEnabled(await getCurrentMember(), enabled.data)) {
    return { ok: false, error: "An administrator must change this setting." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

async function activeOutreachMember() {
  const member = await getCurrentMember();
  return canUseOutreach(member) && await outreachEnabled(member) ? member : null;
}

export async function saveOutreachContactDetailsAction(input: unknown) {
  const parsed = outreachContactDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the contact details." };
  const member = await activeOutreachMember();
  if (!member) return { ok: false as const, error: "Outreach is unavailable." };
  try {
    if (!await saveOutreachContactDetails(member, parsed.data)) {
      return { ok: false as const, error: "This company is no longer available for outreach." };
    }
    for (const path of ["/outreach", "/pipeline", "/companies", "/targets", "/search"]) revalidatePath(path);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not save the company details. Try again." };
  }
}

export async function saveOutreachGuideAction(input: unknown) {
  const parsed = z.strictObject({ guide: outreachGuideSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the script text and give each objection a distinct label and reply." };
  const member = await activeOutreachMember();
  if (!member || member.role !== "admin") return { ok: false as const, error: "An administrator must edit the shared call guide." };
  try {
    const result = await saveOutreachGuide(member, parsed.data.guide, parsed.data.revision);
    if (!result) return { ok: false as const, error: "The call guide changed. Reopen the editor before saving again." };
    revalidatePath("/outreach");
    return { ok: true as const, ...result };
  } catch {
    return { ok: false as const, error: "Could not save the call guide. Try again." };
  }
}

export async function draftOutreachCopyAction(input: unknown) {
  const parsed = z.strictObject({
    field: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(2_000), direction: z.string().trim().max(500),
  }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Add some wording to draft from first." };
  const member = await activeOutreachMember();
  if (!member || member.role !== "admin" || !await outreachAiEnabled(member)) {
    return { ok: false as const, error: "AI drafting requires administrator access and OpenAI enabled for this workspace." };
  }
  try {
    if (!await reserveOutreachAiRequest(member)) return { ok: false as const, error: "Outreach AI is at its short-term limit. Try again in about 15 minutes." };
    const suggestion = await draftOutreachCopy(parsed.data);
    if (suggestion) return { ok: true as const, suggestion };
  } catch { /* The editor keeps the current wording. */ }
  return { ok: false as const, error: "Could not draft wording. Try again." };
}

export async function lookUpOutreachSwitchboardAction(input: unknown) {
  const parsed = z.uuid().safeParse(input);
  const member = await activeOutreachMember();
  if (!parsed.success || !member || !await outreachAiEnabled(member)) {
    return { ok: false as const, error: "Phone lookup requires Outreach and OpenAI enabled for this workspace." };
  }
  try {
    const company = await getOutreachLookupCompany(member, parsed.data);
    const domain = company ? outreachLookupDomain(company.websiteUrl) : null;
    if (!company || !domain) return { ok: false as const, error: "Save the company’s public website first." };
    if (!await reserveOutreachAiRequest(member)) return { ok: false as const, error: "Outreach AI is at its short-term limit. Try again in about 15 minutes." };
    const result = await lookUpOutreachSwitchboard(company.name, domain);
    if (result) return { ok: true as const, ...result };
    return { ok: false as const, error: "No head-office number with an official source was found. You can still check the website." };
  } catch {
    return { ok: false as const, error: "Phone lookup is temporarily unavailable. You can still check the website." };
  }
}

export async function prepareOutreachNumberAction(input: unknown) {
  const parsed = z.strictObject({
    opportunityId: z.uuid(),
    contactId: z.uuid().nullable(),
    number: z.string().max(80).refine((value) => normaliseDialNumber(value) === value),
  }).safeParse(input);
  const member = await activeOutreachMember();
  if (!member) return { ok: false as const, error: "Outreach is unavailable." };
  if (!parsed.success) return { ok: false as const, error: "Choose a number from this opportunity." };
  const { opportunityId, contactId, number } = parsed.data;
  const current = await prepareOutreachNumber(member, opportunityId, contactId, number);
  if (!current) return { ok: false as const, error: "This number is no longer available for outreach. Refresh the list." };
  return { ok: true as const, ...current };
}
