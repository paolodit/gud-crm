import { describe, expect, it } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { deliveryNextMoves } from "./delivery-next-moves";

describe("delivery next moves", () => {
  function fixture() {
    const snapshot = demoBoardForEdition("service");
    snapshot.demoMode = false;
    snapshot.generatedAt = "2026-09-09T10:00:00.000Z";
    snapshot.opportunities = [];
    snapshot.directProjects = ["overdue", "missing", "today", "future", "complete", "archived", "other"].map((name, i) => ({
      id: `91000000-0000-4000-8000-00000000000${i}`, companyName: name, title: name,
      ownerId: name === "other" ? "teammate" : "me", offerId: snapshot.offers[0].id,
      delivery: { stage: name === "complete" ? "complete" : "kickoff", dueDate: name === "overdue" ? "2026-09-08" : name === "today" ? "2026-09-09" : "2026-09-20", nextMilestone: name === "missing" ? "" : "Client approval", notes: "", archivedAt: name === "archived" ? "2026-09-08T10:00:00.000Z" : null },
    }));
    return snapshot;
  }
  it("prioritises overdue and missing milestones, then due dates", () => {
    expect(deliveryNextMoves(fixture(), "me").map((item) => item.project.title)).toEqual(["overdue", "missing", "today", "future"]);
  });
  it("excludes completed, archived and other owners, and honours offers", () => {
    const snapshot = fixture();
    expect(deliveryNextMoves(snapshot, "me", snapshot.offers[1].id)).toHaveLength(0);
    expect(deliveryNextMoves(snapshot, "teammate")).toHaveLength(1);
    snapshot.demoMode = true;
    expect(deliveryNextMoves(snapshot, "me")).toHaveLength(5);
  });
});
