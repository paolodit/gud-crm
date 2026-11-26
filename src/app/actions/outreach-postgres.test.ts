import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OutreachCall } from "@/lib/domain/outreach";
import type { CurrentMember } from "@/lib/session";

const url = process.env.GUD_OUTREACH_TEST_DATABASE_URL;
const actor = vi.hoisted(() => ({ current: null as CurrentMember | null }));
vi.mock("@/lib/session", () => ({ getCurrentMember: async () => actor.current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let pool: typeof import("@/db").pool;
let crm: typeof import("./crm");
let actions: typeof import("./outreach");
let repository: typeof import("@/lib/data/outreach-repository");
let settings: typeof import("@/lib/data/outreach-settings");

async function fixture(role: CurrentMember["role"]) {
  const organisationId = randomUUID(), id = randomUUID(), pipeline = randomUUID(), stage = randomUUID();
  const company = randomUUID(), opportunity = randomUUID();
  await pool.query("INSERT INTO organisations (id, name, settings) VALUES ($1, 'Fixture', $2)", [organisationId, { sales_cockpit: true, otherSetting: true }]);
  await pool.query("INSERT INTO users (id, organisation_id, name, email, role) VALUES ($1, $2, 'Fixture caller', $3, $4)", [id, organisationId, `${id}@fixture.test`, role]);
  await pool.query("INSERT INTO pipelines (id, organisation_id, name) VALUES ($1, $2, 'Fixture pipeline')", [pipeline, organisationId]);
  await pool.query("INSERT INTO stages (id, pipeline_id, name, colour, position) VALUES ($1, $2, 'Outreach active', '#123456', 1)", [stage, pipeline]);
  await pool.query("INSERT INTO companies (id, organisation_id, name, normalised_name, import_metadata) VALUES ($1, $2, 'Fixture retailer', 'fixture retailer', $3)", [company, organisationId, { switchboardPhone: "020 7946 0958" }]);
  await pool.query("INSERT INTO opportunities (id, organisation_id, title, stage_id, company_id, pipeline_id) VALUES ($1, $2, 'Fixture opportunity', $3, $4, $5)", [opportunity, organisationId, stage, company, pipeline]);
  await pool.query("INSERT INTO activity_types (organisation_id, name, channel, icon, colour) VALUES ($1, 'Called', 'phone', 'Phone', '#123456')", [organisationId]);
  const member: CurrentMember = { id, name: "Fixture caller", email: `${id}@fixture.test`, role, organisationId, storageMode: "postgres", demoMode: false };
  return { member, opportunity, company };
}

describe.skipIf(!url)("guided outreach in PostgreSQL", () => {
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith("_release_test")) throw new Error("Use a disposable database ending in _release_test.");
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("DATA_BACKEND", "postgres");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-only-better-auth-secret-for-postgres");
    pool = (await import("@/db")).pool;
    [crm, actions, repository, settings] = await Promise.all([import("./crm"), import("./outreach"), import("@/lib/data/outreach-repository"), import("@/lib/data/outreach-settings")]);
  });

  afterAll(async () => {
    await pool?.end();
    vi.unstubAllEnvs();
  });

  it("scopes lists and writes to the caller's workspace and commits a repeated call only once", async () => {
    const first = await fixture("admin");
    const second = await fixture("member");
    const call: OutreachCall = {
      attemptId: randomUUID(), opportunityId: first.opportunity, contactId: null, number: "02079460958", screened: true,
      outcome: "follow_up", taskTitle: "Send the agreed overview", dueLocal: "2027-01-15T10:30",
      timeZone: "Europe/London", notes: "Asked for more information.", objection: "", stopScope: null,
    };
    actor.current = second.member;
    expect((await repository.getOutreachList(second.member)).candidates.map((item) => item.id)).toEqual([second.opportunity]);
    expect((await actions.prepareOutreachNumberAction({ opportunityId: call.opportunityId, number: call.number, contactId: null })).ok).toBe(false);
    expect((await crm.logOutreachCallAction(call)).ok).toBe(false);
    expect((await actions.saveOutreachSettingAction(false)).ok).toBe(false);

    actor.current = first.member;
    expect((await actions.prepareOutreachNumberAction({ opportunityId: call.opportunityId, number: call.number, contactId: null })).ok).toBe(true);
    expect((await Promise.all([crm.logOutreachCallAction(call), crm.logOutreachCallAction(call)])).map((item) => item.ok)).toEqual([true, true]);
    const { rows: [saved] } = await pool.query("SELECT id, organisation_id, created_by_id, contact_id, outcome FROM activities WHERE opportunity_id = $1", [first.opportunity]);
    expect(saved).toMatchObject({ id: call.attemptId, organisation_id: first.member.organisationId, created_by_id: first.member.id, contact_id: null, outcome: "Follow-up required" });
    expect((await pool.query("SELECT title FROM tasks WHERE opportunity_id = $1", [first.opportunity])).rows).toEqual([{ title: call.taskTitle }]);

    const stop = { ...call, attemptId: randomUUID(), outcome: "do_not_contact", taskTitle: "", dueLocal: "", stopScope: "company" };
    expect((await crm.logOutreachCallAction(stop)).ok).toBe(true);
    expect((await crm.logOutreachCallAction(stop)).ok).toBe(true);
    expect((await repository.getOutreachList(first.member)).candidates).toEqual([]);

    expect((await actions.saveOutreachSettingAction(false)).ok).toBe(true);
    expect((await crm.logOutreachCallAction(call)).ok).toBe(false);
    expect((await actions.saveOutreachSettingAction(true)).ok).toBe(true);
    expect((await pool.query("SELECT settings FROM organisations WHERE id = $1", [first.member.organisationId])).rows[0].settings).toEqual({ sales_cockpit: true, otherSetting: true });
  });

  it("keeps company contact changes and shared call guides inside the current workspace", async () => {
    const first = await fixture("admin");
    const second = await fixture("member");
    const firstGuide = await settings.getOutreachGuide(first.member);
    const guide = { ...firstGuide.guide, opener: "Hi, who looks after store operations?" };
    const edit = { opportunityId: first.opportunity, websiteUrl: "example.com/contact", switchboardPhone: "020 7946 0959" };
    actor.current = second.member;
    expect((await actions.saveOutreachContactDetailsAction(edit)).ok).toBe(false);
    expect((await actions.saveOutreachGuideAction({ guide, revision: firstGuide.revision })).ok).toBe(false);

    actor.current = first.member;
    expect((await actions.saveOutreachContactDetailsAction(edit)).ok).toBe(true);
    expect((await actions.saveOutreachContactDetailsAction({ opportunityId: first.opportunity, switchboardPhone: "020 7946 0957" })).ok).toBe(true);
    expect((await repository.getOutreachList(first.member)).candidates[0]).toMatchObject({
      websiteUrl: "https://example.com/contact", switchboardPhone: "020 7946 0957",
    });
    expect((await repository.getOutreachList(second.member)).candidates[0]).toMatchObject({ websiteUrl: null, switchboardPhone: "020 7946 0958" });
    expect((await actions.saveOutreachGuideAction({ guide, revision: firstGuide.revision })).ok).toBe(true);
    expect((await actions.saveOutreachGuideAction(firstGuide)).ok).toBe(false);
    expect((await settings.getOutreachGuide(first.member)).guide).toEqual(guide);
    expect((await settings.getOutreachGuide(second.member)).guide).toEqual(firstGuide.guide);
    expect((await pool.query("SELECT settings FROM organisations WHERE id = $1", [first.member.organisationId])).rows[0].settings)
      .toMatchObject({ sales_cockpit: true, otherSetting: true });
  });
});
