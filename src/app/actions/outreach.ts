"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prepareOutreachNumber } from "@/lib/data/outreach-repository";
import { canUseOutreach, outreachEnabled, saveOutreachEnabled } from "@/lib/data/outreach-settings";
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

export async function prepareOutreachNumberAction(input: unknown) {
  const parsed = z.strictObject({
    opportunityId: z.uuid(),
    contactId: z.uuid().nullable(),
    number: z.string().max(80).refine((value) => normaliseDialNumber(value) === value),
  }).safeParse(input);
  const member = await getCurrentMember();
  if (!canUseOutreach(member) || !await outreachEnabled(member)) return { ok: false as const, error: "Outreach is unavailable." };
  if (!parsed.success) return { ok: false as const, error: "Choose a number from this opportunity." };
  const { opportunityId, contactId, number } = parsed.data;
  const current = await prepareOutreachNumber(member, opportunityId, contactId, number);
  if (!current) return { ok: false as const, error: "This number is no longer available for outreach. Refresh the list." };
  return { ok: true as const, ...current };
}
