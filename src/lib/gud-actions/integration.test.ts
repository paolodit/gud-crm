import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/lib/session";
const provider = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: provider.respond }; } }));

const url = process.env.GUD_CONVERSATION_TEST_DATABASE_URL;
let database: typeof import("@/db");
let actions: typeof import("./service");
let thoughts: typeof import("@/lib/data/thoughts-repository");
const org = randomUUID(), otherOrg = randomUUID(), pipeline = randomUUID(), stage = randomUUID(), offer = randomUUID();
const actor: CurrentMember = { id: randomUUID(), organisationId: org, name: "Fixture", email: "fixture@gud.test", role: "member", storageMode: "postgres", demoMode: false };
const colleague = { ...actor, id: randomUUID() };
const outsider = { ...actor, id: randomUUID(), organisationId: otherOrg };
const timezone = "Europe/London";
const approve = (d: { id: string; version: number }) => ({ id: d.id, version: d.version });
let leadId: string;

describe.skipIf(!url)("real PostgreSQL GUD actions", () => {
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith("_release_test")) throw new Error("A disposable release-test database is required.");
    Object.assign(process.env, { DATABASE_URL: url, DATA_BACKEND: "postgres", GUD_PUBLIC_DEMO: "false", DEMO_MODE: "false", GUD_CONVERSATION_ENABLED: "true", BETTER_AUTH_SECRET: "ci-only-actions-secret-over-32-characters", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000", AI_ENABLED: "true", AI_PROVIDER: "openai", OPENAI_API_KEY: "test-placeholder-not-a-real-key" });
    database = await import("@/db"); actions = await import("./service"); thoughts = await import("@/lib/data/thoughts-repository");
    const pool = database.pool;
    await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Actions fixture'),($2,'Other fixture')", [org, otherOrg]);
    for (const a of [actor, colleague, outsider]) await pool.query("INSERT INTO users(id,organisation_id,name,email,role) VALUES($1,$2,'Fixture',$3,'member')", [a.id, a.organisationId, `${a.id}@fixture.test`]);
    await pool.query("INSERT INTO pipelines(id,organisation_id,name) VALUES($1,$2,'Sales')", [pipeline, org]);
    await pool.query("INSERT INTO stages(id,pipeline_id,name,colour,position) VALUES($1,$2,'Outreach active','#007bff',1)", [stage, pipeline]);
    await pool.query("INSERT INTO offers(id,organisation_id,name,normalised_name,colour) VALUES($1,$2,'Websites','websites','#007bff')", [offer, org]);
    await pool.query("INSERT INTO activity_types(organisation_id,name,channel,icon,colour) VALUES($1,'Other activity / note','note','FileText','#007bff')", [org]);
  });
  afterAll(async () => { await database?.pool.end(); });
  it("stages Sarah / Acme without touching the CRM; saves all fields once", async () => {
    const draft = await actions.stageDraft(actor, { kind: "lead", timezone, fields: { company: "Acme", title: "New website", contact: "Sarah", value: 5000, offerId: offer, task: "Follow up with Sarah", dueDate: "2026-09-17", dueTime: "10:00", note: "Needs the website before Christmas" } });
    expect((await database.pool.query("SELECT id FROM opportunities WHERE organisation_id=$1", [org])).rowCount).toBe(0);
    expect(await actions.listDrafts(colleague)).toEqual([]);
    expect(await actions.listDrafts(outsider)).toEqual([]);
    await expect(actions.commitDrafts(colleague, [approve(draft)])).rejects.toThrow("unavailable");
    const receipt = await actions.commitDrafts(actor, [approve(draft)]);
    leadId = new URL(receipt[0].href, "https://fixture.test").searchParams.get("opportunity")!;
    expect(await actions.commitDrafts(actor, [approve(draft)])).toEqual(receipt);
    const record = await actions.openRecord(actor, { kind: "lead", id: leadId });
    expect(record.value).toBe(5000); expect(record.contacts[0].name).toBe("Sarah"); expect(record.tasks).toHaveLength(1);
    expect((await database.pool.query("SELECT notes FROM activities WHERE opportunity_id=$1", [leadId])).rows[0].notes).toContain("Christmas");
    expect((await database.pool.query("SELECT id FROM companies WHERE organisation_id=$1", [org])).rowCount).toBe(1);
  });
  it("rejects stale draft edits and CRM changes; preserves newer manual work", async () => {
    const draft = await actions.stageDraft(actor, { kind: "lead", targetId: leadId, timezone, fields: { value: 6000 } });
    const edited = await actions.editDraft(actor, draft.id, draft.version, { value: 7000 });
    await expect(actions.editDraft(actor, draft.id, draft.version, { value: 8000 })).rejects.toThrow("changed");
    await database.pool.query("UPDATE opportunities SET title='Newer human title' WHERE id=$1", [leadId]);
    await expect(actions.commitDrafts(actor, [approve(edited)])).rejects.toThrow("record changed");
    expect((await actions.openRecord(actor, { kind: "lead", id: leadId })).value).toBe(5000);
    await actions.cancelDraft(actor, edited.id, edited.version);
  });
  it("rolls back an earlier nested service save when a later draft fails", async () => {
    const a = await actions.stageDraft(actor, { kind: "lead", timezone, fields: { company: "Rollback Co", title: "Same project", offerId: offer } });
    const b = await actions.stageDraft(actor, { kind: "lead", timezone, fields: { company: "Rollback Co", title: "Same project", offerId: offer } });
    await expect(actions.commitDrafts(actor, [approve(a), approve(b)])).rejects.toThrow("already exists");
    expect((await database.pool.query("SELECT id FROM companies WHERE organisation_id=$1 AND name='Rollback Co'", [org])).rowCount).toBe(0);
    expect((await actions.listDrafts(actor)).filter(d => [a.id, b.id].includes(d.id))).toHaveLength(2);
    await actions.cancelDraft(actor, a.id, a.version); await actions.cancelDraft(actor, b.id, b.version);
  });
  it("supports project lists and private Thoughts without shared Thought audit text", async () => {
    const project = await actions.stageDraft(actor, { kind: "project", timezone, fields: { company: "Acme", title: "Delivery", task: "Prepare brief" } });
    const note = await actions.stageDraft(actor, { kind: "thought", timezone, fields: { body: "Private action fixture secret" } });
    const receipts = await actions.commitDrafts(actor, [approve(project), approve(note)]);
    const id = new URL(receipts[0].href, "https://fixture.test").searchParams.get("project")!;
    const record = await actions.openRecord(actor, { kind: "project", id });
    const update = await actions.stageDraft(actor, { kind: "project", targetId: id, timezone, fields: { completeTaskIds: [record.tasks[0].id], note: "Brief approved" } });
    await actions.commitDrafts(actor, [approve(update)]);
    expect((await actions.openRecord(actor, { kind: "project", id })).tasks[0].completed).toBe(true);
    expect(await thoughts.listThoughts(colleague)).toEqual([]);
    expect((await thoughts.listThoughts(actor))[0].body).toBe("Private action fixture secret");
    const audit = await database.pool.query("SELECT * FROM audit_events WHERE organisation_id=$1", [org]);
    expect(JSON.stringify(audit.rows)).not.toContain("Private action fixture secret");
  });
  it("isolates simultaneous outer transactions and clears the context after rollback", async () => {
    const { organisations } = await import("@/db/schema");
    const a = randomUUID(), b = randomUUID();
    const result = await Promise.allSettled([
      database.withDatabaseTransaction(async () => { await database.db.insert(organisations).values({ id: a, name: "Rollback" }); throw new Error("rollback"); }),
      database.withDatabaseTransaction(async () => { await database.db.insert(organisations).values({ id: b, name: "Commit" }); }),
    ]);
    expect(result.map(r => r.status)).toEqual(["rejected", "fulfilled"]);
    expect((await database.pool.query("SELECT id FROM organisations WHERE id=ANY($1::uuid[])", [[a,b]])).rows.map(r => r.id)).toEqual([b]);
  });
  it("scopes conversations and allows one voice connection, with explicit provider hangup", async () => {
    const conversation = await import("./conversation");
    await database.pool.query("UPDATE organisations SET ai_enabled=true WHERE id=$1", [org]);
    const session = await conversation.startConversation(actor);
    await expect(conversation.requireConversation(colleague, session.id)).rejects.toThrow("ended");
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.endsWith("/hangup")) expect(JSON.parse(String((options?.body as FormData).get("session"))).audio.output.voice).toBe("cedar");
      return new Response(url.endsWith("/hangup") ? null : "fixture-answer-sdp", { status: url.endsWith("/hangup") ? 200 : 201, headers: { location: "https://api.openai.com/v1/realtime/calls/fixture_call" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const input = { page: "/pipeline" as const, recordId: null, timezone };
      const results = await Promise.allSettled([conversation.connectRealtime(actor, session.id, "fixture-offer-sdp", input, "cedar"), conversation.connectRealtime(actor, session.id, "fixture-offer-sdp", input, "cedar")]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(conversation.executeConversationTool(actor, session.id, "save", {}, timezone)).rejects.toThrow("not available");
      await conversation.recordUsage(actor, session.id, { input_tokens: 10, output_tokens: 20 });
      await conversation.recordUsage(actor, session.id, { input_tokens: 5, output_tokens: 5 });
      expect((await conversation.requireConversation(actor, session.id)).usage.input_tokens).toBe(15);
      await conversation.endConversation(actor, session.id);
      expect(fetcher.mock.calls.at(-1)?.[0]).toContain("fixture_call/hangup");
      await expect(conversation.requireConversation(actor, session.id)).rejects.toThrow("ended");
    } finally { vi.unstubAllGlobals(); }
  });
  it("discards a typed provider response arriving after End without executing its actions", async () => {
    const conversation = await import("./conversation");
    const session = await conversation.startConversation(actor);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    provider.respond.mockImplementationOnce(async () => {
      entered(); await delayed;
      return { output: [{ type: "function_call", name: "navigate", arguments: '{"screen":"thoughts"}', call_id: "late-response" }] };
    });
    const result = conversation.textConversation(actor, session.id, [{ role: "user", content: "Open Thoughts" }], { page: "/pipeline", recordId: null, timezone });
    // Attach the rejection handler before releasing the delayed response.
    const rejected = expect(result).rejects.toThrow("ended");
    await started; await conversation.endConversation(actor, session.id); release(); await rejected;
    expect(provider.respond).toHaveBeenCalledTimes(1);
    const row = (await database.pool.query("SELECT request_count FROM gud_conversation_sessions WHERE id=$1", [session.id])).rows[0];
    expect(row.request_count).toBe(1);
  });
  it("hangs up a voice call that finishes connecting after the user ended the session", async () => {
    const conversation = await import("./conversation");
    const session = await conversation.startConversation(actor);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/hangup")) return new Response(null, { status: 200 });
      entered(); await delayed;
      return new Response("fixture-answer-sdp", { status: 201, headers: { location: "https://api.openai.com/v1/realtime/calls/late_fixture_call" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = conversation.connectRealtime(actor, session.id, "fixture-offer-sdp", { page: "/pipeline", recordId: null, timezone });
      const rejected = expect(result).rejects.toThrow("ended while voice was connecting");
      await started; await conversation.endConversation(actor, session.id); release(); await rejected;
      expect(fetcher.mock.calls.at(-1)?.[0]).toContain("late_fixture_call/hangup");
      await expect(conversation.requireConversation(actor, session.id)).rejects.toThrow("ended");
    } finally { vi.unstubAllGlobals(); }
  });
});
