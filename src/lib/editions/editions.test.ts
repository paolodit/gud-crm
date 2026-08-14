import { describe, expect, it } from "vitest";

import { demoBoardForEdition } from "@/lib/demo-data";
import { createInitialSnapshot } from "@/lib/editions/bootstrap";
import { getEdition, isEditionKey } from "@/lib/editions";

describe("sales editions", () => {
  it("keeps Focused Sales as the safe fallback for existing workspaces", () => {
    expect(getEdition(undefined).key).toBe("focused");
    expect(isEditionKey("focused")).toBe(true);
    expect(isEditionKey("unknown")).toBe(false);
  });

  it("creates a clean Service Sales workspace without focused demo prospects", () => {
    const snapshot = createInitialSnapshot("service", "sqlite");

    expect(snapshot.edition).toBe("service");
    expect(snapshot.pipeline.name).toBe("Service Sales");
    expect(snapshot.offers.map((offer) => offer.name)).toEqual(["Primary service"]);
    expect(snapshot.opportunities).toEqual([]);
    expect(snapshot.users.map((user) => user.name)).toEqual(["Alex Morgan"]);
    expect(snapshot.stages.some((stage) => stage.name === "Proposal / decision")).toBe(true);
    expect(snapshot.stages.some((stage) => stage.name === "Ready to contact")).toBe(false);
  });

  it("creates a clean Focused Sales workspace without mixing in public demo records", () => {
    const snapshot = createInitialSnapshot("focused", "sqlite");

    expect(snapshot.edition).toBe("focused");
    expect(snapshot.pipeline.name).toBe("Focused Sales");
    expect(snapshot.opportunities).toEqual([]);
    expect(snapshot.offers[0]?.name).toBe("Core product");
  });

  it("ships distinct fictional fixtures for both public demo modes", () => {
    const focused = demoBoardForEdition("focused");
    const service = demoBoardForEdition("service");

    expect(focused.edition).toBe("focused");
    expect(focused.offers).toHaveLength(1);
    expect(service.edition).toBe("service");
    expect(service.offers.length).toBeGreaterThan(1);
    expect(service.opportunities.length).toBeGreaterThan(0);
    expect(service.opportunities.every((item) => item.company.scaleNote?.startsWith("Fictional"))).toBe(true);
    expect(service.opportunities.every((item) => !item.company.name.startsWith("DEMO"))).toBe(true);
    expect(new Set(service.opportunities.map((item) => item.offer?.id)).size).toBeGreaterThan(1);
  });
});
