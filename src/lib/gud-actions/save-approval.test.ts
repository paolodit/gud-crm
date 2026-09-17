import { describe, expect, it } from "vitest";
import { approvedDrafts, isSaveRequest, VoiceSaveApproval } from "./save-approval";

describe("explicit conversational save approval", () => {
  it.each(["OK, save the changes.", "OK, save changes.", "Perfect. Perfect. Can you save it, please?", "Please save all drafts", "Save"])("accepts %s", text => expect(isSaveRequest(text)).toBe(true));
  it.each(["That's it", "don't save", "Can you save later?", "If it looks good save", "The note says save changes", "Add a task and save", "save it? no", "GUD: save changes"])("rejects %s", text => expect(isSaveRequest(text)).toBe(false));
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
