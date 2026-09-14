import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { demoBoardForEdition } from "@/lib/demo-data";
import { saveSoloModeAction } from "./workspace";

const mocks = vi.hoisted(() => ({ member: vi.fn(), update: vi.fn(), audit: vi.fn(), transaction: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/enrichment/config", () => ({ saveFreeMaxRuntimeConfiguration: vi.fn() }));
vi.mock("@/lib/data/workspace-repository", () => ({ salesAssetDefaults: [] }));
vi.mock("@/lib/data/local-store", () => ({ updateLocalBoardSnapshot: mocks.update, recordLocalAuditEvent: mocks.audit }));
vi.mock("@/lib/session", () => ({ getCurrentMember: mocks.member }));
const member = { id: "member", organisationId: "workspace", role: "admin", storageMode: "sqlite", demoMode: false };
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue(member); });

describe("solo mode workspace setting", () => {
  it("changes only the preference, preserving every assignment", async () => {
    const snapshot = demoBoardForEdition("service"), before = structuredClone(snapshot);
    mocks.update.mockImplementation((update) => update(snapshot));
    expect(await saveSoloModeAction({ soloMode: true })).toEqual({ ok: true });
    expect(snapshot).toEqual({ ...before, soloMode: true });
    expect(await saveSoloModeAction({ soloMode: false })).toEqual({ ok: true });
    expect(snapshot).toEqual({ ...before, soloMode: false });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it.each([null, { ...member, role: "member" }, { ...member, storageMode: "demo" }])("rejects unsigned, non-admin and unsaved sessions", async (actor) => {
    mocks.member.mockResolvedValue(actor);
    expect((await saveSoloModeAction({ soloMode: true })).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects non-boolean input", async () => {
    expect((await saveSoloModeAction({ soloMode: "true" })).ok).toBe(false);
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("merges the PostgreSQL preference within the signed-in tenant only", async () => {
    mocks.member.mockResolvedValue({ ...member, storageMode: "postgres" });
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: member.organisationId }]) });
    const set = vi.fn().mockReturnValue({ where });
    mocks.transaction.mockImplementation(async (fn) => fn({ update: () => ({ set }), insert: () => ({ values: mocks.audit }) }));
    expect(await saveSoloModeAction({ soloMode: true })).toEqual({ ok: true });
    const predicate = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(predicate.params).toEqual([member.organisationId]);
    const value = new PgDialect().sqlToQuery(set.mock.calls[0][0].settings);
    expect(value.sql).toContain('"settings" ||');
    expect(value.params).toEqual(['{"soloMode":true}']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ organisationId: member.organisationId, actorId: member.id }));
  });
});
