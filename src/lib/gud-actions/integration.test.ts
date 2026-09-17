import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/lib/session";
import { fieldsSchema, type GudDraft, type GudFields } from "./contract";
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
  beforeEach(() => provider.respond.mockReset());
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith("_release_test")) throw new Error("A disposable release-test database is required.");
    Object.assign(process.env, { DATABASE_URL: url, DATA_BACKEND: "postgres", GUD_PUBLIC_DEMO: "false", DEMO_MODE: "false", GUD_CONVERSATION_ENABLED: "true", BETTER_AUTH_SECRET: "ci-only-actions-secret-over-32-characters", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000", AI_ENABLED: "true", AI_PROVIDER: "openai", AI_RATE_LIMIT: "30", OPENAI_API_KEY: "test-placeholder-not-a-real-key" });
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
  it("saves the transcript's coloured, categorised Thought and real checklist on explicit request", async () => {
    const conversation = await import("./conversation");
    await database.pool.query("UPDATE organisations SET ai_enabled=true WHERE id=$1", [org]);
    const session = await conversation.startConversation(actor);
    const fields = (patch: GudFields) => ({ ...Object.fromEntries(Object.keys(fieldsSchema.shape).map(key => [key, null])), ...patch });
    const staged = await conversation.executeConversationTool(actor, session.id, "stage_change", { kind: "thought", targetId: null, draftId: null, version: null, fields: fields({ title: "Job reminder", body: "Must go for a job today", colour: "rose" }) }, timezone) as { draft: GudDraft };
    const revised = await conversation.executeConversationTool(actor, session.id, "revise_draft", { draftId: staged.draft.id, version: staged.draft.version, fields: fields({ category: "Video Ideas", addTasks: ["Sausages", "Potatoes", "Dog"] }) }, timezone) as { draft: GudDraft };
    const draft = revised.draft, save = { draftIds: [draft.id] };
    await expect(conversation.executeConversationTool(actor, session.id, "save_changes", save, timezone)).rejects.toThrow("explicitly");
    const approval = { utterance: "Perfect. Perfect. Can you save it, please?", capturedAt: Date.now(), drafts: [approve(draft)] };
    const result = await conversation.executeConversationTool(actor, session.id, "save_changes", save, timezone, approval) as { receipts: Array<{ href: string }>; saved: boolean };
    expect(result.saved).toBe(true);
    const id = new URL(result.receipts[0].href, "https://fixture.test").searchParams.get("thought")!;
    const note = await thoughts.getThought(actor, id);
    expect(note).toMatchObject({ colour: "rose", category: "Video Ideas", body: "Must go for a job today" });
    expect(note.checklist.map(t => t.text)).toEqual(["Sausages", "Potatoes", "Dog"]);
    await conversation.executeConversationTool(actor, session.id, "save_changes", save, timezone, approval);
    expect((await thoughts.listThoughts(actor)).filter(n => n.id === id)).toHaveLength(1);
    expect(await actions.searchRecords(colleague, "Job reminder", "thought")).toMatchObject({ matches: [] });
    expect(await actions.searchRecords(actor, "Job reminder", "all")).toMatchObject({ matches: [] });
    await expect(actions.openRecord(colleague, { kind: "thought", id })).rejects.toThrow();
    const update = await actions.stageDraft(actor, { kind: "thought", targetId: id, timezone, fields: { colour: "sky", category: "video ideas", completeTaskIds: [note.checklist[0].id], addTasks: ["Write CV"] } });
    await actions.commitDrafts(actor, [approve(update)]);
    const changed = await thoughts.getThought(actor, id);
    expect(changed).toMatchObject({ colour: "sky", category: "Video Ideas", body: note.body, x: note.x, y: note.y });
    expect(changed.checklist).toHaveLength(4); expect(changed.checklist[0].done).toBe(true);
    const stale = await actions.stageDraft(actor, { kind: "thought", targetId: id, timezone, fields: { body: "Voice body" } });
    await thoughts.saveThought(actor, { id, version: changed.version, content: { title: changed.title, body: "Newer human body", colour: changed.colour, category: changed.category, checklist: changed.checklist, x: changed.x, y: changed.y } });
    await expect(actions.commitDrafts(actor, [approve(stale)])).rejects.toThrow("Thought changed");
    expect((await thoughts.getThought(actor, id)).body).toBe("Newer human body");
    await actions.cancelDraft(actor, stale.id, stale.version);
    await conversation.endConversation(actor, session.id);
  });
  it("adds separate project tasks across turns without confusing a record version with a draft version", async () => {
    const conversation = await import("./conversation");
    const session = await conversation.startConversation(actor);
    const fields = (patch: GudFields) => ({ ...Object.fromEntries(Object.keys(fieldsSchema.shape).map(key => [key, null])), ...patch });
    const project = await actions.stageDraft(actor, { kind: "project", timezone, fields: { company: "Cargo fixture", title: "Power Cargo", value: 1500, note: "Contact: Carter", nextMilestone: "Refine sitemap", dueDate: "2026-10-01", offerId: offer, ownerId: colleague.id } });
    const [receipt] = await actions.commitDrafts(actor, [approve(project)]);
    const id = new URL(receipt.href, "https://fixture.test").searchParams.get("project")!;
    const a = await conversation.executeConversationTool(actor, session.id, "stage_change", { kind: "project", targetId: id, draftId: null, version: 1, fields: fields({ addTasks: ["Build $1 trial"] }) }, timezone) as { draft: GudDraft };
    const b = await conversation.executeConversationTool(actor, session.id, "revise_draft", { draftId: a.draft.id, version: a.draft.version, fields: fields({ addTasks: ["Draft a logo", "Speak to Carter and refine sitemap and project cost"] }) }, timezone) as { draft: GudDraft };
    expect(b.draft.fields.addTasks).toHaveLength(3);
    const approval = { utterance: "Save changes", capturedAt: Date.now(), drafts: [approve(a.draft)] };
    await expect(conversation.executeConversationTool(actor, session.id, "save_changes", { draftIds: [b.draft.id] }, timezone, approval)).rejects.toThrow("changed");
    await conversation.executeConversationTool(actor, session.id, "save_changes", { draftIds: [b.draft.id] }, timezone, { ...approval, drafts: [approve(b.draft)] });
    const result = await actions.openRecord(actor, { kind: "project", id });
    expect(result.tasks.map(t => t.title)).toEqual(b.draft.fields.addTasks);
    expect(result).toMatchObject({ value: 1500, details: { nextMilestone: "Refine sitemap", dueDate: "2026-10-01", notes: "Contact: Carter", ownerId: colleague.id, offerId: offer } });
    expect(await conversation.executeConversationTool(actor, session.id, "close_record", {}, timezone)).toEqual({ closeRecord: true });
    await conversation.endConversation(actor, session.id);
  });
  it("persists rich opportunity details, named contacts and a real touchpoint", async () => {
    const refs = await actions.actionReferences(actor);
    const draft = await actions.stageDraft(actor, { kind: "lead", targetId: leadId, timezone, fields: { value: 7200, priority: "high", temperature: "hot", probability: 75, expectedCloseDate: "2026-11-12", ownerId: colleague.id, outreachAngle: "New AI business website", fitScore: 4, qualificationNote: "Budget confirmed", contact: "Luke", contactEmail: "luke@fixture.test", contactPhone: "+441234567890", contactTitle: "Founder", note: "Discussed website scope", activityTypeId: refs.activityTypes[0].id, activityOutcome: "Agreed follow-up", occurredAt: "2026-09-17T10:00:00Z" } });
    await actions.commitDrafts(actor, [approve(draft)]);
    const record = await actions.openRecord(actor, { kind: "lead", id: leadId });
    expect(record).toMatchObject({ value: 7200, details: { priority: "high", temperature: "hot", probability: 75, ownerId: colleague.id, fitScore: 4, qualificationNote: "Budget confirmed", outreachAngle: "New AI business website" } });
    expect(record.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Luke", email: "luke@fixture.test", phone: "+441234567890", title: "Founder" })]));
    expect(record.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Sarah" })]));
    const touch = (await database.pool.query("SELECT notes,outcome,occurred_at FROM activities WHERE opportunity_id=$1 ORDER BY created_at DESC LIMIT 1", [leadId])).rows[0];
    expect(touch).toMatchObject({ notes: "Discussed website scope", outcome: "Agreed follow-up", occurred_at: new Date("2026-09-17T10:00:00Z") });
  });
  it("handles an explicit typed save without a model round trip", async () => {
    const conversation = await import("./conversation");
    const draft = await actions.stageDraft(actor, { kind: "thought", timezone, fields: { body: "Direct typed save fixture" } });
    const session = await conversation.startConversation(actor);
    provider.respond.mockClear();
    const result = await conversation.textConversation(actor, session.id, [{ role: "user", content: "OK, save the changes." }], { page: "/thoughts", recordId: null, timezone });
    expect(result).toMatchObject({ message: "Saved. All Gud.", drafts: [], events: [{ saved: true, receipts: [{ draftId: draft.id }] }] });
    expect(provider.respond).not.toHaveBeenCalled();
    await conversation.endConversation(actor, session.id);
  });
  it("drafts City Travel's stage-only move through the real conversation boundary", async () => {
    const conversation = await import("./conversation");
    const nextStage = randomUUID();
    await database.pool.query("INSERT INTO stages(id,pipeline_id,name,colour,position) VALUES($1,$2,'Conversation active','#007bff',2)", [nextStage, pipeline]);
    const created = await actions.stageDraft(actor, { kind: "lead", timezone, fields: { company: "City Travel", title: "Travel website", offerId: offer } });
    await actions.commitDrafts(actor, [approve(created)]);
    const session = await conversation.startConversation(actor);
    const found = await conversation.executeConversationTool(actor, session.id, "search", { query: "City Travel", kind: "lead" }, timezone) as { record: { id: string }; navigate: string };
    expect(found.navigate).toBe(`/pipeline?opportunity=${found.record.id}`);
    const { draft } = await conversation.executeConversationTool(actor, session.id, "stage_change", { kind: "lead", targetId: found.record.id, fields: { stageId: nextStage } }, timezone) as { draft: GudDraft };
    expect(draft.fields).toEqual({ stageId: nextStage });
    expect(await actions.openRecord(actor, { kind: "lead", id: found.record.id })).toMatchObject({ stageId: stage });
    await conversation.executeConversationTool(actor, session.id, "save_changes", { draftIds: [draft.id] }, timezone, { utterance: "Save changes", capturedAt: Date.now(), drafts: [approve(draft)] });
    expect(await actions.openRecord(actor, { kind: "lead", id: found.record.id })).toMatchObject({ stageId: nextStage });
    await conversation.endConversation(actor, session.id);
  });
  it("creates and revises Matteo's Thought from sparse model arguments, then saves on request", async () => {
    const conversation = await import("./conversation");
    const session = await conversation.startConversation(actor);
    provider.respond.mockResolvedValueOnce({ output: [{ type: "function_call", name: "stage_change", call_id: "matteo-create", arguments: JSON.stringify({ kind: "thought", targetId: null, fields: { title: "Take Matteo shopping", addTasks: ["Go to shop 1", "Go to shop 2"] } }) }] });
    provider.respond.mockResolvedValueOnce({ output: [], output_text: "Drafted." });
    const result = await conversation.textConversation(actor, session.id, [{ role: "user", content: "Create a thought titled Take Matteo shopping with list items go to shop 1 and go to shop 2" }], { page: "/thoughts", recordId: null, timezone });
    const original = result.drafts.find(d => d.fields.title === "Take Matteo shopping")!;
    expect(original).toBeDefined();
    expect(result.events[0]).not.toHaveProperty("error");
    expect((await thoughts.listThoughts(actor)).some(t => t.title === original.fields.title)).toBe(false);
    const { draft } = await conversation.executeConversationTool(actor, session.id, "revise_draft", { draftId: original.id, version: original.version, fields: { colour: "rose", category: "Family", addTasks: ["Head home"], body: null } }, timezone) as { draft: GudDraft };
    expect(draft.fields.addTasks).toEqual(["Go to shop 1", "Go to shop 2", "Head home"]);
    const saved = await conversation.textConversation(actor, session.id, [{ role: "user", content: "Save changes" }], { page: "/thoughts", recordId: null, timezone });
    expect(saved.message).toBe("Saved. All Gud.");
    const note = (await thoughts.listThoughts(actor)).find(t => t.title === "Take Matteo shopping")!;
    expect(note).toMatchObject({ colour: "rose", category: "Family" });
    expect(note.checklist.map(t => t.text)).toEqual(draft.fields.addTasks);
    await conversation.endConversation(actor, session.id);
  });
  it("reads BHBI's checklist and drafts Email 4 as the milestone without completing tasks", async () => {
    const conversation = await import("./conversation");
    const created = await actions.stageDraft(actor, { kind: "project", timezone, fields: { company: "BHBI", title: "Email campaign", nextMilestone: "Email 1", addTasks: ["Email 1", "Email 2", "Email 3", "Email 4"] } });
    await actions.commitDrafts(actor, [approve(created)]);
    const session = await conversation.startConversation(actor);
    const found = await conversation.executeConversationTool(actor, session.id, "search", { query: "BHBI", kind: "project" }, timezone) as { record: { id: string; tasks: Array<{ title: string }> }; navigate: string };
    expect(found.navigate).toBe(`/live?project=${found.record.id}`);
    expect(found.record.tasks.map(t => t.title)).toEqual(["Email 1", "Email 2", "Email 3", "Email 4"]);
    const { draft } = await conversation.executeConversationTool(actor, session.id, "stage_change", { kind: "project", targetId: found.record.id, fields: { nextMilestone: found.record.tasks[3].title } }, timezone) as { draft: GudDraft };
    expect(await actions.openRecord(actor, { kind: "project", id: found.record.id })).toMatchObject({ details: { nextMilestone: "Email 1" } });
    await conversation.executeConversationTool(actor, session.id, "save_changes", { draftIds: [draft.id] }, timezone, { utterance: "Save changes", capturedAt: Date.now(), drafts: [approve(draft)] });
    const record = await actions.openRecord(actor, { kind: "project", id: found.record.id });
    expect(record).toMatchObject({ details: { nextMilestone: "Email 4" } });
    expect(record.tasks.every(t => !t.completed)).toBe(true);
    await conversation.endConversation(actor, session.id);
  });
  it("gives batch-created Thoughts separate positions, including concurrent saves", async () => {
    const drafts = await Promise.all(Array.from({ length: 3 }, (_, i) => actions.stageDraft(actor, { kind: "thought", timezone, fields: { body: `Batch placement ${i}` } })));
    await actions.commitDrafts(actor, drafts.map(approve));
    await Promise.all(Array.from({ length: 3 }, (_, i) => thoughts.saveThought(actor, { content: { body: `Concurrent placement ${i}` } })));
    const mixed = await actions.stageDraft(actor, { kind: "thought", timezone, fields: { body: "Voice and manual together" } });
    await Promise.all([
      actions.commitDrafts(actor, [approve(mixed)]),
      thoughts.saveThought(actor, { content: { body: "Manual and voice together" } }),
    ]);
    const notes = await thoughts.listThoughts(actor);
    for (const a of notes) for (const b of notes) if (a.id !== b.id) expect(Math.abs(a.x-b.x) >= 310 || Math.abs(a.y-b.y) >= 400).toBe(true);
    expect(await thoughts.listThoughts(colleague)).toEqual([]);
  });
  it("scopes conversations and allows one voice connection, with explicit provider hangup", async () => {
    const conversation = await import("./conversation");
    await database.pool.query("UPDATE organisations SET ai_enabled=true WHERE id=$1", [org]);
    const session = await conversation.startConversation(actor);
    await expect(conversation.requireConversation(colleague, session.id)).rejects.toThrow("ended");
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.endsWith("/hangup")) {
        const config = JSON.parse(String((options?.body as FormData).get("session")));
        expect(config.audio.output.voice).toBe("cedar");
        expect(config.audio.input.turn_detection.eagerness).toBe("high");
        expect(config.instructions).toContain("search with kind lead");
      }
      return new Response(url.endsWith("/hangup") ? null : "fixture-answer-sdp", { status: url.endsWith("/hangup") ? 200 : 201, headers: { location: "https://api.openai.com/v1/realtime/calls/fixture_call" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const input = { page: "/pipeline" as const, recordId: null, timezone };
      const results = await Promise.allSettled([conversation.connectRealtime(actor, session.id, "fixture-offer-sdp", input, "cedar"), conversation.connectRealtime(actor, session.id, "fixture-offer-sdp", input, "cedar")]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const found = await conversation.executeConversationTool(actor, session.id, "search", { query: "Acme", kind: "lead" }, timezone);
      expect(found).toMatchObject({ navigate: `/pipeline?opportunity=${leadId}`, record: { id: leadId, kind: "lead" } });
      const ambiguous = await conversation.executeConversationTool(actor, session.id, "search", { query: "Acme", kind: "all" }, timezone);
      expect(ambiguous).not.toHaveProperty("navigate");
      expect(ambiguous).not.toHaveProperty("record");
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
