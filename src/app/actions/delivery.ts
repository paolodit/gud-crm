"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/session";
import { updateDelivery } from "@/lib/data/delivery-repository";
import { publicActionError } from "@/lib/action-error";

export async function updateDeliveryAction(input: unknown) {
  try {
    const member = await getCurrentMember();
    if (!member) throw new Error("You must be signed in.");
    const result = await updateDelivery(member, input);
    revalidatePath("/live");
    revalidatePath("/pipeline");
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: publicActionError(error, "Project could not be updated.") };
  }
}
