import { describe, expect, it } from "vitest";
import type { SpokenCrmDraft } from "@/app/actions/ai";
import { configuredDeliveryStages, deliveryDetails } from "./delivery";
import { mergeDeliveryDraft } from "./delivery-voice";

describe("delivery voice review", () => {
  const current = deliveryDetails({ stage: "kickoff", notes: "Original notes", nextMilestone: "Brief", dueDate: "2026-09-20" });
  const stages = configuredDeliveryStages(undefined);
  const draft = (fields: Partial<SpokenCrmDraft>) => ({ kind: "delivery_update", ...fields }) as SpokenCrmDraft;
  it("preserves omitted fields and appends notes", () => {
    const result = mergeDeliveryDraft(current, draft({ deliveryNotes: "Draft approved", deliveryStage: "in_progress" }), stages);
    expect(result.delivery).toMatchObject({ stage: "in_progress", notes: "Original notes\n\nDraft approved", nextMilestone: "Brief", dueDate: "2026-09-20" });
    expect(result.count).toBe(2);
    expect(current.stage).toBe("kickoff");
  });
  it("ignores sales fields and unknown delivery stages", () => {
    expect(mergeDeliveryDraft(current, draft({ deliveryStage: "lost", title: "Changed" }), stages)).toEqual({ delivery: current, count: 0 });
    expect(mergeDeliveryDraft(current, draft({ kind: "activity_update", deliveryStage: "complete" }), stages).count).toBe(0);
  });
  it("does not apply invalid dates or overflowing notes", () => {
    expect(mergeDeliveryDraft(current, draft({ deliveryDueDate: "tomorrow" }), stages).count).toBe(0);
    expect(mergeDeliveryDraft(current, draft({ deliveryNotes: "a".repeat(10000) }), stages).count).toBe(0);
  });
});
