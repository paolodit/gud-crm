import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { configuredDeliveryStages, deliveryDetails, liveProjectRecords } from "@/lib/domain/delivery";
import { mutateLiveWorkspace } from "./live-workspace";
import { updateDelivery } from "./delivery-repository";
import { updateLocalBoardSnapshot, recordLocalAuditEvent } from "./local-store";
import { db } from "@/db";
import { organisations, opportunities, users, offers } from "@/db/schema";
import type { CurrentMember } from "@/lib/session";

vi.mock("@/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("./local-store", () => ({ updateLocalBoardSnapshot: vi.fn(), recordLocalAuditEvent: vi.fn() }));
const actor: CurrentMember = { id: "00000000-0000-4000-8000-000000000001", organisationId: "00000000-0000-4000-8000-000000000002", name: "Test", email: "test@example.com", role: "admin", demoMode: false, storageMode: "sqlite" };
const project = { id: "00000000-0000-4000-8000-000000000003", title: "Existing work", companyName: "Example", ownerId: null, offerId: null, delivery: deliveryDetails({ projectValue: 8000.50 }) };
beforeEach(() => vi.clearAllMocks());

describe("standalone projects and stage settings", () => {
  it("creates, archives and restores direct work without creating sales records", async () => {
    const snapshot = demoBoardForEdition("service");
    const before = structuredClone(snapshot.opportunities);
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    await mutateLiveWorkspace(actor, { kind: "project", project, create: true });
    expect(snapshot.directProjects).toEqual([project]);
    expect(snapshot.opportunities).toEqual(before);
    const archived = { ...project, delivery: { ...project.delivery, archivedAt: "2026-09-08T12:00:00.000Z" } };
    await mutateLiveWorkspace(actor, { kind: "project", project: archived, create: false });
    expect(liveProjectRecords(snapshot).find((item) => item.id === project.id)?.delivery.archivedAt).toBeTruthy();
    await mutateLiveWorkspace(actor, { kind: "project", project, create: false });
    expect(snapshot.directProjects).toEqual([project]);
    expect(snapshot.opportunities).toEqual(before);
    expect(recordLocalAuditEvent).toHaveBeenCalledTimes(3);
  });
  it("accepts the text IDs used by SQLite and Better Auth for owners", async () => {
    const snapshot = demoBoardForEdition("service");
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    await mutateLiveWorkspace(actor, { kind: "project", project: { ...project, ownerId: snapshot.users[0].id }, create: true });
    expect(snapshot.directProjects?.[0].ownerId).toBe(snapshot.users[0].id);
  });
  it("reassigns removed stages for direct and sales projects, including archived delivery", async () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.directProjects = [{ ...project, delivery: { ...project.delivery, archivedAt: "2026-09-08T12:00:00.000Z" } }];
    snapshot.opportunities[0].delivery = deliveryDetails({ nextMilestone: "Retain this" });
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    const next = configuredDeliveryStages(undefined).filter((stage) => stage.id !== "kickoff");
    await expect(mutateLiveWorkspace(actor, { kind: "stages", stages: next })).rejects.toThrow("replacement");
    await mutateLiveWorkspace(actor, { kind: "stages", stages: next, replacements: { kickoff: "in_progress" } });
    expect(snapshot.directProjects[0].delivery.stage).toBe("in_progress");
    expect(snapshot.directProjects[0].delivery.archivedAt).toBeTruthy();
    expect(snapshot.opportunities[0].delivery).toEqual({ ...deliveryDetails({}), stage: "in_progress", nextMilestone: "Retain this" });
  });
  it("rejects invalid targets, workspace references and non-admin stage edits", async () => {
    const snapshot = demoBoardForEdition("service");
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    await expect(mutateLiveWorkspace(actor, { kind: "project", project, create: false })).rejects.toThrow("not found");
    await expect(mutateLiveWorkspace(actor, { kind: "project", project: { ...project, ownerId: project.id }, create: true })).rejects.toThrow("owner");
    await expect(mutateLiveWorkspace(actor, { kind: "project", project: { ...project, delivery: { ...project.delivery, stage: "missing" } }, create: true })).rejects.toThrow("existing delivery stage");
    await expect(mutateLiveWorkspace({ ...actor, role: "member" }, { kind: "stages", stages: configuredDeliveryStages(undefined) })).rejects.toThrow("Only admins");
  });
  it("validates configured stages for sales delivery and preserves independent archive state", async () => {
    const snapshot = demoBoardForEdition("service");
    const record = snapshot.opportunities[0];
    record.stageId = snapshot.stages.find((stage) => stage.terminalType === "won")!.id;
    snapshot.deliveryStages = [{ id: "custom", name: "Custom", colour: "#123456", description: "" }];
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    await expect(updateDelivery(actor, { opportunityId: record.id, delivery: { stage: "kickoff" } })).rejects.toThrow("existing delivery stage");
    await updateDelivery(actor, { opportunityId: record.id, delivery: { archivedAt: "2026-09-08T12:00:00.000Z" } });
    expect(record.delivery?.stage).toBe("custom");
    expect(record.archivedAt).toBeFalsy();
    await updateDelivery(actor, { opportunityId: record.id, delivery: { archivedAt: null } });
    expect(record.delivery?.archivedAt).toBeNull();
  });
  it("uses a tenant lock and preserves unrelated PostgreSQL settings on creation", async () => {
    const settings = { edition: "service", privateFlag: "preserve" };
    const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
    const lock = vi.fn();
    const predicates: unknown[] = [];
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: (predicate: unknown) => {
        predicates.push(predicate);
        const rows = table === organisations ? [{ settings }] : table === users || table === offers || table === opportunities ? [] : [];
        return Object.assign(Promise.resolve(rows), { for: (mode: string) => { lock(mode); return Promise.resolve(rows); } });
      } }) }),
      update: (table: unknown) => ({ set: (value: Record<string, unknown>) => ({ where: async () => { writes.push({ table, value }); } }) }),
      insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
    };
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(tx as never));
    await mutateLiveWorkspace({ ...actor, storageMode: "postgres" }, { kind: "project", project, create: true });
    expect(lock).toHaveBeenCalledWith("update");
    expect(writes).toEqual([{ table: organisations, value: { settings: { ...settings, deliveryStages: configuredDeliveryStages(undefined), directProjects: [project] } } }]);
    expect(predicates.length).toBe(3);
  });
});
