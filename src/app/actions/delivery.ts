"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/session";
import { updateDelivery } from "@/lib/data/delivery-repository";
import { publicActionError } from "@/lib/action-error";
import { mutateLiveWorkspace } from "@/lib/data/live-workspace";

export async function mutateLiveAction(input: unknown) {
  try {
    const member = await getCurrentMember();
    if (!member) throw new Error("You must be signed in.");
    await mutateLiveWorkspace(member, input);
    for (const path of ["/live", "/settings", "/reports"]) revalidatePath(path);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: publicActionError(error, "Live workspace could not be saved.") };
  }
}

export async function updateDeliveryAction(input: unknown) {
  try {
    const member = await getCurrentMember();
    if (!member) throw new Error("You must be signed in.");
    const result = await updateDelivery(member, input);
    revalidatePath("/live");
    revalidatePath("/pipeline");
    revalidatePath("/reports");
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: publicActionError(error, "Project could not be updated.") };
  }
}
