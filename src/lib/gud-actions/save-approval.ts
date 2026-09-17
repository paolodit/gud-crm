import { z } from "zod";
import { GudActionError } from "./contract";

export const saveApprovalSchema = z.object({
  utterance: z.string().max(12000),
  capturedAt: z.number().int(),
  drafts: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).max(8),
}).strict();
export type SaveApproval = z.infer<typeof saveApprovalSchema>;

/** Correlate delayed transcription to the utterance and drafts actually heard. */
export class VoiceSaveApproval {
  private current?: { itemId: string; capturedAt: number; drafts: SaveApproval["drafts"]; completed: boolean; approval?: SaveApproval };
  private waiting = new Set<(approval?: SaveApproval) => void>();
  reset() { this.current = undefined; this.resolve(); }
  begin(itemId: string, drafts: SaveApproval["drafts"]) {
    this.reset();
    this.current = { itemId, capturedAt: Date.now(), drafts: drafts.map(d => ({ ...d })), completed: false };
  }
  complete(itemId: string, utterance: string) {
    const current = this.current;
    if (!current || current.itemId !== itemId || current.completed) return;
    current.completed = true;
    if (isSaveRequest(utterance)) current.approval = { utterance, capturedAt: current.capturedAt, drafts: current.drafts };
    this.resolve(current.approval);
  }
  wait(timeoutMs = 4000): Promise<SaveApproval | undefined> {
    if (!this.current || this.current.completed) return Promise.resolve(this.current?.approval);
    return new Promise(resolve => {
      const finish = (approval?: SaveApproval) => { clearTimeout(timer); this.waiting.delete(finish); resolve(approval); };
      const timer = setTimeout(() => finish(), timeoutMs);
      this.waiting.add(finish);
    });
  }
  private resolve(approval?: SaveApproval) { for (const finish of this.waiting) finish(approval); }
}

// Deliberately narrow: an actual user command, not quoted CRM text, a model
// assertion, a conditional instruction or a casual conversation sign-off.
export function isSaveRequest(text: string) {
  const words = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:ok|okay|great|perfect|yes|thanks|thank you|please) )*(?:(?:can|could|would) you )?save(?: (?:all(?: (?:the|my|these))?|the|my|these))?(?: (?:changes|drafts|it|this|that))?(?: (?:now|please|for me))*$/.test(words);
}

export function approvedDrafts(raw: unknown, requested: string[], now = Date.now()) {
  const result = saveApprovalSchema.safeParse(raw);
  if (!result.success || !isSaveRequest(result.data.utterance)) throw new GudActionError("Please explicitly ask to save the visible changes, or use Save changes. Nothing was saved.");
  const approval = result.data;
  if (now - approval.capturedAt > 120000 || approval.capturedAt > now + 5000) throw new GudActionError("That save request expired. Review the drafts and ask to save again.");
  if (!approval.drafts.length) throw new GudActionError("No reviewed drafts were present when you asked. Review the new draft, then ask to save it.");
  if (approval.drafts.length > 1 && !/\b(?:all|changes|drafts)\b/i.test(approval.utterance)) throw new GudActionError("Several drafts are open. Say 'save all drafts' or save the selection in the app.");
  if (new Set(requested).size !== requested.length || requested.length !== approval.drafts.length || requested.some(id => !approval.drafts.some(d => d.id === id))) throw new GudActionError("The draft selection changed. Review it and ask to save again.");
  return approval.drafts;
}
