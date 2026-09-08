import { describe, expect, it } from "vitest";
import { deliveryDetails, deliveryPatchSchema, deliveryStages, getLiveProjects } from "./delivery";
import { demoBoardForEdition } from "@/lib/demo-data";

describe("live project model", () => {
  it("gives existing wins a kickoff bucket without changing their sales stage", () => {
    const snapshot = demoBoardForEdition("service");
    const record = snapshot.opportunities[0];
    const won = snapshot.stages.find((stage) => stage.terminalType === "won")!;
    record.stageId = won.id;
    const before = structuredClone(record);
    expect(getLiveProjects([record], snapshot.stages)).toHaveLength(1);
    expect(deliveryDetails(record.delivery).stage).toBe("kickoff");
    expect(record).toEqual(before);
  });
  it("excludes lost, open, archived opportunities and archived companies", () => {
    const snapshot = demoBoardForEdition("service");
    const won = snapshot.stages.find((stage) => stage.terminalType === "won")!;
    const base = snapshot.opportunities[0];
    const records = [base, { ...base, stageId: won.id, archivedAt: new Date().toISOString() }, { ...base, stageId: won.id, company: { ...base.company, archivedAt: new Date().toISOString() } }];
    expect(getLiveProjects(records, snapshot.stages)).toHaveLength(0);
  });
  it("validates stages, real dates and preserves omitted fields in patches", () => {
    expect(deliveryStages).toHaveLength(5);
    expect(deliveryPatchSchema.parse({ stage: "client_review" })).toEqual({ stage: "client_review" });
    expect(deliveryPatchSchema.safeParse({ stage: "" }).success).toBe(false);
    expect(deliveryPatchSchema.safeParse({ dueDate: "2026-02-30" }).success).toBe(false);
    expect(deliveryPatchSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
    expect(deliveryPatchSchema.safeParse({}).success).toBe(false);
  });
});
