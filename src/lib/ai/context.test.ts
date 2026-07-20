import { describe, expect, it } from "vitest";

import { assembleAICoachContext } from "@/lib/ai/context";
import { aiCoachOutputSchema } from "@/lib/ai/schema";
import { LocalCoachProvider } from "@/lib/ai/provider";
import { demoBoard } from "@/lib/demo-data";

describe("AI coach", () => {
  it("selects bounded, referenced context", () => {
    const opportunity = structuredClone(demoBoard.opportunities[0]);
    opportunity.activities = Array.from({ length: 14 }, (_, index) => ({
      ...opportunity.activities[0],
      id: crypto.randomUUID(),
      occurredAt: new Date(Date.UTC(2026, 6, 17, index)).toISOString(),
    }));
    const context = assembleAICoachContext(demoBoard, opportunity);
    expect(context.recentActivities).toHaveLength(8);
    expect(context.contextReferences.activityIds).toEqual(context.recentActivities.map((item) => item.id));
    expect(context.offer?.name).toBe("Core product");
    expect(context.contextReferences.offerIds).toEqual([demoBoard.offers[0].id]);
  });

  it("returns validated local coaching without sending anything", async () => {
    const context = assembleAICoachContext(demoBoard, demoBoard.opportunities[0]);
    const result = await new LocalCoachProvider().generate(context, "coach");
    expect(aiCoachOutputSchema.safeParse(result.output).success).toBe(true);
    expect(result.output.nextActions.length).toBeGreaterThan(0);
    expect(result.provider).toBe("local-rules");
  });

  it("offers a permission-based recovery path for a cold lead", async () => {
    const context = assembleAICoachContext(demoBoard, demoBoard.opportunities[0]);
    const result = await new LocalCoachProvider().generate(context, "recovery");
    expect(result.output.nextActions[0]?.title).toContain("close-the-loop");
    expect(result.output.drafts[0]?.text).toContain("Should I close the loop");
  });
});
