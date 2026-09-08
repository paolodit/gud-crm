import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { describeWorkspace, getOpportunities, getOpportunity, getSalesBrief, listLiveProjects } from "./service";

vi.mock("@/lib/data/crm-repository", () => ({ getBoardSnapshot: vi.fn() }));
const actor = { id: "demo-admin", name: "Alex", email: "alex@example.com", organisationId: "00000000-0000-4000-8000-000000000001", role: "admin" as const };
beforeEach(() => { vi.mocked(getBoardSnapshot).mockReset(); });

describe("bounded MCP reads", () => {
  it("lists direct projects without putting them in sales and excludes archived delivery", async () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.opportunities = [];
    snapshot.deliveryStages = [{ id: "custom", name: "Custom", colour: "#123456", description: "" }];
    const project = { id: "00000000-0000-4000-8000-000000000003", title: "Delivery only", companyName: "Example", ownerId: null, offerId: null, delivery: { stage: "custom", dueDate: null, nextMilestone: "", notes: "" } };
    snapshot.directProjects = [project, { ...project, id: "00000000-0000-4000-8000-000000000004", delivery: { ...project.delivery, archivedAt: "2026-09-08T12:00:00.000Z" } }];
    vi.mocked(getBoardSnapshot).mockResolvedValue(snapshot);
    const result = await listLiveProjects(actor, { limit: 10, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.projects[0].source).toBe("direct");
    expect(result.deliveryStages).toEqual(snapshot.deliveryStages);
  });
  it("loads metadata without loading opportunity history", async () => {
    vi.mocked(getBoardSnapshot).mockResolvedValue({ ...demoBoardForEdition("service"), opportunities: [] });
    const result = await describeWorkspace(actor);
    expect(getBoardSnapshot).toHaveBeenCalledWith(actor.organisationId, { opportunityIds: [], includeHistory: false });
    expect(result.deliveryStages).toHaveLength(5);
  });
  it("reads only the requested opportunity", async () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.opportunities = [snapshot.opportunities[0]];
    vi.mocked(getBoardSnapshot).mockResolvedValue(snapshot);
    const result = await getOpportunity(actor, snapshot.opportunities[0].id);
    expect(getBoardSnapshot).toHaveBeenCalledWith(actor.organisationId, { opportunityIds: [result.id] });
    expect(result.url).toContain(`/pipeline?opportunity=${result.id}`);
  });
  it("batches records in one tenant-scoped read and reports missing IDs", async () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.opportunities = [snapshot.opportunities[0]];
    vi.mocked(getBoardSnapshot).mockResolvedValue(snapshot);
    const missing = "00000000-0000-4000-8000-000000000099";
    const result = await getOpportunities(actor, [snapshot.opportunities[0].id, missing]);
    expect(getBoardSnapshot).toHaveBeenCalledTimes(1);
    expect(result.records).toHaveLength(1);
    expect(result.missingIds).toEqual([missing]);
  });
  it("does not fetch activity or AI history for a sales brief", async () => {
    vi.mocked(getBoardSnapshot).mockResolvedValue(demoBoardForEdition("service"));
    await getSalesBrief(actor, { scope: "team" });
    expect(getBoardSnapshot).toHaveBeenCalledWith(actor.organisationId, { includeHistory: false });
  });
});
