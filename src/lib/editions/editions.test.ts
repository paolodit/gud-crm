import { describe, expect, it } from "vitest";

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
    expect(snapshot.stages.some((stage) => stage.name === "Proposal sent")).toBe(true);
  });

  it("creates a fictional single-product fixture for Focused Sales workspaces", () => {
    const snapshot = createInitialSnapshot("focused", "sqlite");

    expect(snapshot.edition).toBe("focused");
    expect(snapshot.pipeline.name).toBe("Focused Sales");
    expect(snapshot.opportunities.length).toBeGreaterThan(0);
    expect(snapshot.offers[0]?.name).toBe("Core product");
    expect(snapshot.opportunities.every((item) => item.company.name.startsWith("DEMO ·"))).toBe(true);
  });
});
