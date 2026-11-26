import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { logOutreachCallAction } from "@/app/actions/crm";
import { prepareOutreachNumberAction, saveOutreachContactDetailsAction, saveOutreachGuideAction, saveOutreachSettingAction } from "@/app/actions/outreach";
import { getOutreachList } from "@/lib/data/outreach-repository";
import { getOutreachGuide, outreachEnabled } from "@/lib/data/outreach-settings";
import { getLocalBoardSnapshot, localDatabaseForPrivateData, setLocalSetting, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import { demoBoardForEdition } from "@/lib/demo-data";
import type { OutreachCall } from "@/lib/domain/outreach";
import type { CurrentMember } from "@/lib/session";

const mocks = vi.hoisted(() => ({ member: vi.fn(), dbPath: `data/outreach-${process.pid}-${Math.random().toString(36).slice(2)}.db` }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: { sqliteMode: true, demoMode: false, SQLITE_PATH: mocks.dbPath, defaultEdition: "service" } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentMember: mocks.member }));

const admin: CurrentMember = {
  id: "outreach-admin", name: "Outreach Admin", email: "outreach@example.test",
  organisationId: "00000000-0000-4000-8000-000000000001", role: "admin", demoMode: false, storageMode: "sqlite",
};
const member: CurrentMember = { ...admin, id: "outreach-member", role: "member" };

function boardFixture() {
  const source = demoBoardForEdition("service");
  const [first, second] = source.opportunities;
  const stage = source.stages.find((item) => item.name === "Outreach active")!;
  first.stageId = stage.id;
  first.archivedAt = null;
  first.company = { ...first.company, doNotContact: false, archivedAt: null, switchboardPhone: "020 7946 0958" };
  first.contacts = [{ id: randomUUID(), name: "Example Contact", title: "Retail operations", email: null,
    phone: "+44 7700 900321", linkedinUrl: null, primary: true, doNotContact: false }];
  first.activities = [];
  first.tasks = [];
  second.stageId = source.stages.find((item) => item.terminalType === "lost")!.id;
  updateLocalBoardSnapshot((board) => Object.assign(board, { ...source, opportunities: [first, second] }));
  return first;
}

function actualCall(opportunityId: string, fields: Partial<OutreachCall> = {}): OutreachCall {
  return {
    attemptId: randomUUID(), opportunityId, contactId: null, number: "02079460958", screened: true, outcome: "no_answer",
    notes: "", objection: "", taskTitle: "", dueLocal: "", timeZone: "Europe/London", stopScope: null, ...fields,
  };
}

beforeEach(() => {
  mocks.member.mockResolvedValue(admin);
  setLocalSetting("sales_cockpit", false);
});

afterAll(() => {
  localDatabaseForPrivateData().close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(mocks.dbPath + suffix, { force: true });
});

describe("guided outreach", () => {
  it("defaults to off, refuses settings changes from members, and blocks direct actions when disabled", async () => {
    const item = boardFixture();
    expect(await outreachEnabled(admin)).toBe(false);
    mocks.member.mockResolvedValue(member);
    expect((await saveOutreachSettingAction(true)).ok).toBe(false);
    expect((await logOutreachCallAction(actualCall(item.id))).ok).toBe(false);
    expect((await prepareOutreachNumberAction(actualCall(item.id))).ok).toBe(false);
    mocks.member.mockResolvedValue(admin);
    expect((await saveOutreachSettingAction(true)).ok).toBe(true);
    expect(await outreachEnabled(member)).toBe(true);
    expect(await outreachEnabled({ ...member, impersonated: true })).toBe(false);
    expect(await outreachEnabled({ ...admin, storageMode: "demo", demoMode: true })).toBe(false);
    mocks.member.mockResolvedValue(null);
    expect((await logOutreachCallAction(actualCall(item.id))).ok).toBe(false);
  });

  it("excludes closed and restricted companies and hides a switchboard shared with an opted-out contact", async () => {
    const item = boardFixture();
    let list = await getOutreachList(admin);
    expect(list.candidates.map((candidate) => candidate.id)).toEqual([item.id]);
    expect(list.candidates[0].numbers).toHaveLength(2);
    updateLocalBoardSnapshot((board) => {
      board.opportunities[1].contacts = [{ ...item.contacts[0], id: randomUUID(), phone: "+44 (0)20 7946 0958", doNotContact: true }];
    });
    list = await getOutreachList(admin);
    expect(list.candidates[0].numbers.map((number) => number.contactId)).toEqual([item.contacts[0].id]);
    await saveOutreachSettingAction(true);
    expect((await prepareOutreachNumberAction({ opportunityId: item.id, contactId: null, number: "02079460958" })).ok).toBe(false);
    expect((await logOutreachCallAction(actualCall(item.id))).ok).toBe(false);
    expect((await logOutreachCallAction(actualCall(randomUUID()))).ok).toBe(false);
    updateLocalBoardSnapshot((board) => { board.opportunities[0].company.doNotContact = true; });
    expect((await getOutreachList(admin)).candidates).toEqual([]);
  });

  it("logs one phone activity and one CRM task for the same attempt across concurrent submissions and re-enable", async () => {
    const item = boardFixture();
    await saveOutreachSettingAction(true);
    mocks.member.mockResolvedValue(member);
    const input = actualCall(item.id, { outcome: "follow_up", notes: "Ask for retail operations.", objection: "Send me information",
      taskTitle: "Send the promised details", dueLocal: "2027-01-15T10:30" });
    const results = await Promise.all([logOutreachCallAction(input), logOutreachCallAction(input)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    const saved = getLocalBoardSnapshot().opportunities[0];
    expect(saved.activities).toHaveLength(1);
    expect(saved.activities[0]).toMatchObject({ id: input.attemptId, outcome: "Follow-up required", createdById: member.id, type: { channel: "phone" } });
    expect(saved.activities[0].notes).toContain("Objection: Send me information");
    expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0]).toMatchObject({ title: input.taskTitle, dueAt: "2027-01-15T10:30:00.000Z" });
    expect(saved.stageId).toBe(item.stageId);
    expect((await logOutreachCallAction({ ...input, notes: "Changed after a successful save" })).ok).toBe(false);
    mocks.member.mockResolvedValue(admin);
    await saveOutreachSettingAction(false);
    expect((await logOutreachCallAction(input)).ok).toBe(false);
    await saveOutreachSettingAction(true);
    expect(getLocalBoardSnapshot().opportunities[0].activities).toHaveLength(1);
  });

  it("saves only the requested fields on an eligible company and ignores an unsafe website", async () => {
    const item = boardFixture();
    const closed = getLocalBoardSnapshot().opportunities[1];
    const edit = { opportunityId: item.id, websiteUrl: "example.com/contact", switchboardPhone: "020 7946 0959" };
    expect((await saveOutreachContactDetailsAction(edit)).ok).toBe(false);
    await saveOutreachSettingAction(true);
    mocks.member.mockResolvedValue(member);
    expect((await saveOutreachContactDetailsAction({ ...edit, opportunityId: closed.id })).ok).toBe(false);
    expect((await saveOutreachContactDetailsAction({ ...edit, websiteUrl: "javascript:alert(1)" })).ok).toBe(false);
    expect((await saveOutreachContactDetailsAction(edit)).ok).toBe(true);
    expect((await saveOutreachContactDetailsAction({ opportunityId: item.id, websiteUrl: "example.com/head-office" })).ok).toBe(true);
    const [updated, unchanged] = getLocalBoardSnapshot().opportunities;
    expect(updated.company).toMatchObject({ websiteUrl: "https://example.com/head-office", switchboardPhone: "020 7946 0959" });
    expect(unchanged.company).toEqual(closed.company);
    updateLocalBoardSnapshot((board) => { board.opportunities[0].company.doNotContact = true; });
    expect((await saveOutreachContactDetailsAction(edit)).ok).toBe(false);
  });

  it("keeps the shared guide across re-enable and prevents members and stale editors from overwriting it", async () => {
    const { guide, revision } = await getOutreachGuide(admin);
    const update = { guide: { ...guide, opener: "Hi, who manages retail compliance?" }, revision };
    expect((await saveOutreachGuideAction(update)).ok).toBe(false);
    await saveOutreachSettingAction(true);
    mocks.member.mockResolvedValue(member);
    expect((await saveOutreachGuideAction(update)).ok).toBe(false);
    mocks.member.mockResolvedValue(admin);
    expect((await saveOutreachGuideAction(update)).ok).toBe(true);
    expect((await saveOutreachGuideAction({ guide, revision })).ok).toBe(false);
    await saveOutreachSettingAction(false);
    await saveOutreachSettingAction(true);
    expect((await getOutreachGuide(member)).guide.opener).toBe(update.guide.opener);
  });

  it("requires an agreed demo time and applies do-not-contact to the selected scope", async () => {
    const item = boardFixture();
    await saveOutreachSettingAction(true);
    expect((await logOutreachCallAction(actualCall(item.id, { outcome: "demo_booked" }))).ok).toBe(false);
    expect((await logOutreachCallAction(actualCall(item.id, { outcome: "demo_booked", dueLocal: "2027-03-28T01:30" }))).ok).toBe(false);
    expect((await logOutreachCallAction(actualCall(item.id, { outcome: "demo_booked", dueLocal: "2027-01-15T10:30" }))).ok).toBe(true);
    const stop = actualCall(item.id, { outcome: "do_not_contact", stopScope: "contact", contactId: item.contacts[0].id, number: "+447700900321" });
    expect((await logOutreachCallAction(stop)).ok).toBe(true);
    expect((await logOutreachCallAction(stop)).ok).toBe(true);
    expect((await logOutreachCallAction({ ...stop, attemptId: randomUUID() })).ok).toBe(false);
    const saved = getLocalBoardSnapshot().opportunities[0];
    expect(saved.activities).toHaveLength(2);
    expect(saved.tasks.map((task) => task.title)).toEqual(["Attend booked demo"]);
    expect(saved.company.doNotContact).toBe(false);
    expect(saved.contacts[0].doNotContact).toBe(true);
  });
});
