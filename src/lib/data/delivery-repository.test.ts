import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { demoBoardForEdition } from "@/lib/demo-data";
import { updateDelivery } from "./delivery-repository";
import { db } from "@/db";
import { recordLocalAuditEvent, updateLocalBoardSnapshot } from "./local-store";

vi.mock("@/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("./local-store", () => ({ updateLocalBoardSnapshot: vi.fn(), recordLocalAuditEvent: vi.fn() }));

const actor = { id: "00000000-0000-4000-8000-000000000001", organisationId: "00000000-0000-4000-8000-000000000002" };
const original = { stage: "kickoff" as const, dueDate: "2026-10-15", nextMilestone: "Keep this milestone", notes: "Preserve the brief" };
beforeEach(() => { vi.clearAllMocks(); });

describe("delivery persistence safety", () => {
  it("merges SQLite delivery fields without changing contacts, tasks or sales status", async () => {
    const snapshot = demoBoardForEdition("service");
    const record = snapshot.opportunities[0];
    record.stageId = snapshot.stages.find((stage) => stage.terminalType === "won")!.id;
    record.delivery = { ...original };
    const before = structuredClone(record);
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((update) => { update(snapshot); return snapshot; });
    const result = await updateDelivery({ ...actor, storageMode: "sqlite" }, { opportunityId: record.id, delivery: { stage: "client_review" } });
    expect(result.delivery).toEqual({ ...original, stage: "client_review" });
    expect(record).toEqual({ ...before, delivery: result.delivery });
    expect(recordLocalAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.id, action: "delivery.updated", entityId: record.id }));
  });

  it("rejects an archived or non-won SQLite record", async () => {
    const snapshot = demoBoardForEdition("service");
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((update) => { update(snapshot); return snapshot; });
    await expect(updateDelivery({ ...actor, storageMode: "sqlite" }, { opportunityId: snapshot.opportunities[0].id, delivery: { stage: "complete" } })).rejects.toThrow("unarchived, won");
    expect(recordLocalAuditEvent).not.toHaveBeenCalled();
  });

  it("merges PostgreSQL fields identically under a tenant-scoped row lock", async () => {
    const record = { opportunity: { id: actor.id, delivery: original, archivedAt: null }, terminalType: "won", companyArchived: null };
    const { tx, set, where, lock, values } = databaseFixture([record]);
    vi.mocked(db.transaction).mockImplementation(async (work) => work(tx as never));
    const result = await updateDelivery(actor, { opportunityId: actor.id, delivery: { stage: "client_review" } });
    expect(result.delivery).toEqual({ ...original, stage: "client_review" });
    expect(set.mock.calls[0][0]).toEqual({ delivery: result.delivery, updatedAt: expect.any(Date) });
    const predicate = new PgDialect().sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(predicate.sql).toContain('"organisation_id"');
    expect(predicate.params).toContain(actor.organisationId);
    expect(lock).toHaveBeenCalledWith("update", expect.any(Object));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ organisationId: actor.organisationId, actorId: actor.id, action: "delivery.updated" }));
  });

  it.each([
    [],
    [{ opportunity: { archivedAt: null }, terminalType: "open", companyArchived: null }],
    [{ opportunity: { archivedAt: new Date() }, terminalType: "won", companyArchived: null }],
    [{ opportunity: { archivedAt: null }, terminalType: "won", companyArchived: new Date() }],
  ])("refuses missing, archived and non-won PostgreSQL records", async (...rows) => {
    const { tx, set, values } = databaseFixture(rows);
    vi.mocked(db.transaction).mockImplementation(async (work) => work(tx as never));
    await expect(updateDelivery(actor, { opportunityId: actor.id, delivery: { stage: "complete" } })).rejects.toThrow("unarchived, won");
    expect(set).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });
});

function databaseFixture(rows: unknown[]) {
  const lock = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ for: lock }) });
  const query = { innerJoin: vi.fn(), where }; query.innerJoin.mockReturnValue(query);
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const values = vi.fn().mockResolvedValue(undefined);
  const tx = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(query) }), update: vi.fn().mockReturnValue({ set }), insert: vi.fn().mockReturnValue({ values }) };
  return { tx, set, where, lock, values };
}
