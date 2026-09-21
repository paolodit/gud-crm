import { describe, expect, it } from "vitest";
import { advanceSaveApproval, approvedDrafts, isSaveRequest, LiveSaveApproval, VoiceSaveApproval } from "./save-approval";

describe("explicit conversational save approval", () => {
  it("accepts additive saves only for versions produced by that request", () => {
    const id = crypto.randomUUID();
    const approval = { utterance: "Add a call note and save changes", capturedAt: Date.now(), drafts: [{ id, version: 2 }] };
    expect(() => approvedDrafts(approval, [id])).toThrow("Prepare the requested addition");
    advanceSaveApproval(approval, [{ id, version: 2 }], { id, version: 3 });
    expect(approval.drafts).toEqual([{ id, version: 3 }]);
    expect(approvedDrafts(approval, [id])).toEqual([{ id, version: 3 }]);
    advanceSaveApproval(approval, [{ id, version: 4 }], { id, version: 5 });
    expect(approval.drafts[0].version).toBe(3); // never approve a manual edit
    const plain = { ...approval, utterance: "Save changes", drafts: [{ id, version: 2 }] };
    advanceSaveApproval(plain, [{ id, version: 2 }], { id, version: 3 });
    expect(plain.drafts[0].version).toBe(2);
  });
  it("Live captions cannot authorize from assistant text, stale versions or corrected commands", () => {
    const state = new LiveSaveApproval(), drafts = [{ id: crypto.randomUUID(), version: 2 }];
    state.observe({ id: "assistant", role: "assistant", content: "save changes" }, drafts);
    expect(state.approval()).toBeUndefined();
    state.observe({ id: "user", role: "user", content: "Save changes" }, drafts.map(d => ({ ...d, fields: { title: "Never send whole drafts as approval" } })));
    expect(Object.keys(state.approval()!.drafts[0])).toEqual(["id", "version"]);
    drafts[0].version = 3;
    expect(state.approval()?.drafts[0].version).toBe(2);
    state.observe({ id: "user", role: "user", content: "Save changes. No, do not save yet." }, drafts);
    expect(state.approval()).toBeUndefined();
    state.observe({ id: "next", role: "user", content: "Add a task and save changes" }, drafts);
    state.advance(drafts, { id: drafts[0].id, version: 4 });
    expect(state.approval()?.drafts[0].version).toBe(4);
    state.reset(); expect(state.approval()).toBeUndefined();
  });
  it.each(["Add a note and don't save", "Add a task and save if it is ready", 'Add a note saying "save changes"', "The user said add a note and save"])("rejects indirect/conditional additive saves: %s", text => expect(isSaveRequest(text)).toBe(false));
  it.each(["OK, save the changes.", "OK, save changes.", "Perfect. Perfect. Can you save it, please?", "Please save all drafts", "Save", "Add a task and save", "Add a note about the call and save changes", "Save changes and add a follow-up"])("accepts %s", text => expect(isSaveRequest(text)).toBe(true));
  it.each(["That's it", "don't save", "Can you save later?", "If it looks good save", "The note says save changes", "save it? no", "GUD: save changes"])("rejects %s", text => expect(isSaveRequest(text)).toBe(false));
  it("binds the approval to the exact visible drafts and time", () => {
    const id = crypto.randomUUID();
    const approval = { utterance: "save changes", capturedAt: 1000, drafts: [{ id, version: 2 }] };
    expect(approvedDrafts(approval, [id], 2000)).toEqual(approval.drafts);
    expect(() => approvedDrafts(approval, [crypto.randomUUID()], 2000)).toThrow("selection changed");
    expect(() => approvedDrafts(approval, [id], 122000)).toThrow("expired");
    expect(() => approvedDrafts({ ...approval, utterance: "all gud" }, [id], 2000)).toThrow("explicitly");
    expect(() => approvedDrafts({ ...approval, drafts: [] }, [id], 2000)).toThrow("No reviewed");
  });
  it("waits for delayed transcription but keeps the versions visible at speech start", async () => {
    const state = new VoiceSaveApproval(), drafts = [{ id: crypto.randomUUID(), version: 2 }];
    state.begin("save-utterance", drafts);
    const waiting = state.wait();
    drafts[0].version = 3;
    state.complete("save-utterance", "OK, save changes.");
    expect((await waiting)?.drafts[0].version).toBe(2);
    state.reset();
    expect(await state.wait()).toBeUndefined();
  });
  it("never uses a previous utterance's delayed transcription for a new request", async () => {
    const state = new VoiceSaveApproval(), drafts = [{ id: crypto.randomUUID(), version: 1 }];
    state.begin("previous", drafts);
    const previous = state.wait();
    state.begin("current", drafts);
    expect(await previous).toBeUndefined();
    state.complete("previous", "save changes");
    const current = state.wait();
    state.complete("current", "Do not save");
    expect(await current).toBeUndefined();
    state.complete("current", "save changes");
    expect(await state.wait()).toBeUndefined();
  });
  it("times out or cancels safely without a transcription", async () => {
    const state = new VoiceSaveApproval();
    state.begin("silent", []);
    expect(await state.wait(1)).toBeUndefined();
    const waiting = state.wait();
    state.reset();
    expect(await waiting).toBeUndefined();
  });
});
