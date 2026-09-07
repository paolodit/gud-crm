import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoBoardForEdition } from "@/lib/demo-data";
import { completeTaskAction, createNextActionAction } from "./crm";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/crm-repository", () => ({ getBoardSnapshot: mocks.snapshot }));
vi.mock("@/lib/data/local-store", () => ({ updateLocalBoardSnapshot: mocks.update, recordLocalAuditEvent: mocks.audit }));
vi.mock("@/lib/session", () => ({ getCurrentMember: async () => ({ id: "user", organisationId: "workspace", role: "admin", storageMode: "sqlite", demoMode: false }) }));

beforeEach(() => vi.clearAllMocks());

describe("standalone next actions", () => {
  it("creates a real task without inventing activity and returns the saved record", async () => {
    const board = demoBoardForEdition("service");
    const record = board.opportunities[0];
    record.tasks = [];
    const activities = structuredClone(record.activities);
    mocks.update.mockImplementation((update) => { update(board); return board; });
    mocks.snapshot.mockResolvedValue(board);
    const result = await createNextActionAction({ opportunityId: record.id, title: "Send the agreed outline", dueAt: "2026-10-16T09:00:00Z" });
    expect(result.ok).toBe(true);
    expect(record.tasks).toHaveLength(1);
    expect(record.tasks[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.nextActionAt).toBe("2026-10-16T09:00:00.000Z");
    expect(record.activities).toEqual(activities);
    if (result.ok) expect(result.opportunity).toBe(record);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "task.created" }));

    const completed = await completeTaskAction({ taskId: record.tasks[0].id });
    expect(completed.ok).toBe(true);
    expect(record.tasks[0].status).toBe("completed");
    expect(record.nextActionAt).toBeNull();
    expect(record.activities).toEqual(activities);
  });

  it("uses the earliest remaining task after completion", async () => {
    const board = demoBoardForEdition("service");
    const record = board.opportunities[0];
    const id = "00000000-0000-4000-8000-000000000001";
    record.tasks = [
      { id, title: "First", dueAt: "2026-10-01T09:00:00Z", status: "open", owner: null, contactId: null },
      { id: crypto.randomUUID(), title: "Later", dueAt: "2026-10-20T09:00:00Z", status: "open", owner: null, contactId: null },
      { id: crypto.randomUUID(), title: "Next", dueAt: "2026-10-10T09:00:00Z", status: "open", owner: null, contactId: null },
    ];
    mocks.update.mockImplementation((update) => { update(board); return board; });
    mocks.snapshot.mockResolvedValue(board);
    expect((await completeTaskAction({ taskId: id })).ok).toBe(true);
    expect(record.nextActionAt).toBe("2026-10-10T09:00:00Z");
  });

  it("refuses a task for an archived opportunity", async () => {
    const board = demoBoardForEdition("service");
    board.opportunities[0].archivedAt = new Date().toISOString();
    mocks.update.mockImplementation((update) => { update(board); return board; });
    const result = await createNextActionAction({ opportunityId: board.opportunities[0].id, title: "Send the outline", dueAt: "2026-10-16T09:00:00Z" });
    expect(result.ok).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
