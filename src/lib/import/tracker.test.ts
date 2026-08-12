import { describe, expect, it } from "vitest";

import { companyKey, extractDomain, mapTrackerStage, normaliseName } from "./tracker";

describe("tracker normalisation", () => {
  it("normalises names consistently", () => {
    expect(normaliseName("DEMO Clothing & Co."))
      .toBe(normaliseName("DEMO Clothing and Co"));
  });

  it("prefers a normalised domain as the company key", () => {
    expect(companyKey("https://www.oliverbonas.com/shops", "Different name"))
      .toBe("oliverbonas.com");
    expect(extractDomain("www.whitestuff.com")).toBe("whitestuff.com");
  });

  it("maps tracker workflow states to pipeline progress", () => {
    expect(mapTrackerStage("Outreach Ready", "Contact identified")).toBe("Researching");
    expect(mapTrackerStage("Outreach started", "Contact identified")).toBe("Outreach active");
    expect(mapTrackerStage("Discovery booked", "Contact identified")).toBe("Conversation active");
    expect(mapTrackerStage("Proposal sent", "Contact identified")).toBe("Proposal / decision");
    expect(mapTrackerStage("Paused", "Researched")).toBe("Research holding");
    expect(mapTrackerStage("Closed", "No fit")).toBe("Research holding");
  });
});
