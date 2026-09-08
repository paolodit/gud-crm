import type { SpokenCrmDraft } from "@/app/actions/ai";
import { deliverySchema, type DeliveryDetails, type DeliveryStage } from "./delivery";

/** Merge only explicit delivery fields; never overwrite earlier notes or sales data. */
export function mergeDeliveryDraft(current: DeliveryDetails, draft: SpokenCrmDraft, stages: DeliveryStage[]) {
  if (draft.kind !== "delivery_update") return { delivery: current, count: 0 };
  const next = { ...current };
  let count = 0;
  if (draft.deliveryStage && stages.some((stage) => stage.id === draft.deliveryStage)) { next.stage = draft.deliveryStage; count++; }
  if (draft.deliveryMilestone?.trim()) { next.nextMilestone = draft.deliveryMilestone.trim(); count++; }
  if (draft.deliveryDueDate) { next.dueDate = draft.deliveryDueDate; count++; }
  if (draft.deliveryNotes?.trim()) { next.notes = [current.notes, draft.deliveryNotes.trim()].filter(Boolean).join("\n\n"); count++; }
  const parsed = deliverySchema.safeParse(next);
  return parsed.success ? { delivery: parsed.data, count } : { delivery: current, count: 0 };
}
