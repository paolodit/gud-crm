import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, organisations } from "@/db/schema";
import { deliveryDetails, type DirectProject } from "@/lib/domain/delivery";
import { demoBoardForEdition } from "@/lib/demo-data";
import type { CurrentMember } from "@/lib/session";
import { updateLocalBoardSnapshot } from "./local-store";
import { reorderLiveProject } from "./live-order-repository";

vi.mock("@/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("./local-store", () => ({ updateLocalBoardSnapshot: vi.fn(), recordLocalAuditEvent: vi.fn() }));
const actor: CurrentMember = { id: "00000000-0000-4000-8000-000000000001", organisationId: "00000000-0000-4000-8000-000000000002", name: "Test", email: "test@example.com", role: "admin", demoMode: false, storageMode: "postgres" };
const first: DirectProject = { id: "00000000-0000-4000-8000-000000000003", title: "Direct", companyName: "Example", ownerId: null, offerId: null, delivery: deliveryDetails({ position: 1000, notes: "Keep me" }) };
const second = { ...first, id: "00000000-0000-4000-8000-000000000004", delivery: deliveryDetails({ position: 2000 }) };
const move = { projectId: first.id, toStageId: "kickoff", overProjectId: second.id, placement: "after" };
beforeEach(() => vi.clearAllMocks());

describe("live board order persistence", () => {
  it("orders mixed sales and direct projects under tenant locks without overwriting other settings", async () => {
    const settings = { soloMode: true, privateFlag: "preserve", directProjects: [first] };
    const fixture = databaseFixture(settings, [{ opportunity: second, companyName: second.companyName }]);
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(fixture.tx as never));
    const result = await reorderLiveProject(actor, move);
    expect(result.find((item) => item.id === first.id)?.delivery).toMatchObject({ position: 2000, notes: "Keep me" });
    expect(result.find((item) => item.id === second.id)?.delivery.position).toBe(1000);
    expect(fixture.locks).toEqual([organisations, opportunities]);
    for (const predicate of fixture.predicates) expect(new PgDialect().sqlToQuery(predicate).params).toContain(actor.organisationId);
    expect(fixture.writes.find((write) => write.table === organisations)?.value).toMatchObject({ settings: { ...settings, directProjects: [{ ...first, delivery: { ...first.delivery, position: 2000 } }] } });
    expect(fixture.audit).toHaveBeenCalledWith(expect.objectContaining({ organisationId: actor.organisationId, action: "delivery.reordered" }));
  });
  it("refuses an inaccessible project or invalid stage before any writes", async () => {
    const fixture = databaseFixture({ directProjects: [second] }, []);
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(fixture.tx as never));
    await expect(reorderLiveProject(actor, move)).rejects.toThrow("no longer");
    await expect(reorderLiveProject(actor, { ...move, toStageId: "not-configured" })).rejects.toThrow("existing delivery stage");
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.audit).not.toHaveBeenCalled();
  });
  it("persists SQLite order without modifying sales follow-ups", async () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.directProjects = structuredClone([first, second]);
    const sales = structuredClone(snapshot.opportunities);
    vi.mocked(updateLocalBoardSnapshot).mockImplementation((fn) => fn(snapshot));
    const result = await reorderLiveProject({ ...actor, storageMode: "sqlite" }, move);
    expect(snapshot.directProjects[0].delivery.position).toBe(2000);
    expect(result.find((item) => item.id === second.id)?.delivery.position).toBe(1000);
    expect(snapshot.opportunities).toEqual(sales);
  });
});

function databaseFixture(settings: Record<string, unknown>, sales: unknown[]) {
  const predicates: SQL[] = [], locks: unknown[] = [];
  const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const audit = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: () => ({ from: (table: unknown) => {
      const query = { innerJoin: vi.fn(), where: (predicate: SQL) => { predicates.push(predicate); return query; }, orderBy: vi.fn(), for: async () => { locks.push(table); return table === organisations ? [{ settings }] : sales; } };
      query.innerJoin.mockReturnValue(query); query.orderBy.mockReturnValue(query); return query;
    } }),
    update: (table: unknown) => ({ set: (value: Record<string, unknown>) => ({ where: async (predicate: SQL) => { predicates.push(predicate); writes.push({ table, value }); } }) }),
    insert: () => ({ values: audit }),
  };
  return { tx, predicates, locks, writes, audit };
}
