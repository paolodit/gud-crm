import { describe, expect, it } from "vitest";

import { getResearchTargets, getSalesBoardSnapshot, researchReadiness } from "@/lib/data/board-selectors";
import { demoBoard } from "@/lib/demo-data";
import type { OpportunitySummary, StageSummary } from "@/lib/domain/types";

describe("board selectors", () => {
  it("partitions research and sales without losing an opportunity", () => {
    const research = getResearchTargets(demoBoard);
    const sales = getSalesBoardSnapshot(demoBoard);
    const ids = [...research, ...sales.opportunities].map((item) => item.id);

    expect(new Set(ids).size).toBe(demoBoard.opportunities.length);
    expect(ids).toHaveLength(demoBoard.opportunities.length);
    expect(sales.stages.every((stage) => !["Researching", "Research holding"].includes(stage.name))).toBe(true);
  });

  it("only marks a target ready when evidence and a contact route exist", () => {
    const stage = { name: "Researching" } as StageSummary;
    const base = structuredClone(demoBoard.opportunities[0]) as OpportunitySummary;
    base.company.researchNote = "A sourced operational fact.";
    base.company.sourceUrls = ["https://example.com/source"];
    base.contacts = [];
    expect(researchReadiness(base, stage)).toBe("needs_contact");

    base.contacts = [{
      id: crypto.randomUUID(),
      name: "Alex Example",
      title: "Operations Director",
      email: "alex@example.com",
      phone: null,
      linkedinUrl: null,
      primary: true,
      doNotContact: false,
    }];
    expect(researchReadiness(base, stage)).toBe("ready");
    expect(researchReadiness(base, { ...stage, name: "Research holding" })).toBe("held");
  });
});
