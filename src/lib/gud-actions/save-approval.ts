import { z } from "zod";
import { GudActionError } from "./contract";

export const saveApprovalSchema = z.object({
  utterance: z.string().max(12000),
  capturedAt: z.number().int(),
  additionsApplied: z.boolean().optional(),
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
    this.current = { itemId, capturedAt: Date.now(), drafts: drafts.map(({ id, version }) => ({ id, version })), completed: false };
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
export function isStandaloneSaveRequest(text: string) {
  const words = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:ok|okay|great|perfect|yes|thanks|thank you|please) )*(?:(?:can|could|would) you )?save(?: (?:all(?: (?:the|my|these))?|the|my|these))?(?: (?:changes|drafts|it|this|that))?(?: (?:now|please|for me))*$/.test(words);
}

/** Only direct commands count. Record text and assistant captions never enter here. */
export function isSaveRequest(text: string) {
  if (isStandaloneSaveRequest(text)) return true;
  if (/["“”]/.test(text) || /\b(?:don['’]?t|do not|not|never|if|unless|before|later|could i|should|said|says|say)\b/i.test(text)) return false;
  const parts = text.split(/\s+(?:and then|then|and)\s+|[.;]/i).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 && parts.some(isStandaloneSaveRequest)
    && parts.every(part => isStandaloneSaveRequest(part) || /^(?:(?:please|can you|could you)\s+)?(?:add|append|include|set|change|update|move|create|make)\b/i.test(part));
}

/** Advance only the exact draft changed by this request, never unrelated/manual edits. */
export function advanceSaveApproval(approval: SaveApproval | undefined, before: SaveApproval["drafts"], draft: { id: string; version: number }) {
  if (!approval || !isSaveRequest(approval.utterance) || isStandaloneSaveRequest(approval.utterance)) return;
  const prior = before.find(d => d.id === draft.id);
  const approved = approval.drafts.find(d => d.id === draft.id);
  if (prior && (!approved || approved.version !== prior.version)) return;
  if (approved) approved.version = draft.version;
  else if (!prior) approval.drafts.push({ id: draft.id, version: draft.version });
  approval.additionsApplied = true;
}

/** Live supplies incremental user captions, not turn-completion events. A caption
 * alone NEVER triggers a save: a tool request, an explicit command, fresh exact
 * draft versions and server validation must all agree. Later corrections revoke it. */
export class LiveSaveApproval {
  private current?: SaveApproval & { captionId: string };
  observe(caption: { id?: string; role: string; content: string }, drafts: SaveApproval["drafts"]) {
    if (caption.role !== "user" || !caption.id) return;
    if (this.current?.captionId !== caption.id) this.current = { captionId: caption.id, utterance: "", capturedAt: Date.now(), drafts: drafts.map(({ id, version }) => ({ id, version })) };
    this.current!.utterance = caption.content;
  }
  approval() {
    if (!this.current || !isSaveRequest(this.current.utterance)) return undefined;
    const { utterance, capturedAt, drafts, additionsApplied } = this.current;
    return { utterance, capturedAt, drafts, ...(additionsApplied ? { additionsApplied } : {}) };
  }
  advance(before: SaveApproval["drafts"], draft: { id: string; version: number }) { advanceSaveApproval(this.current, before, draft); }
  reset() { this.current = undefined; }
}

export function approvedDrafts(raw: unknown, requested: string[], now = Date.now()) {
  const result = saveApprovalSchema.safeParse(raw);
  if (!result.success || !isSaveRequest(result.data.utterance)) throw new GudActionError("Please explicitly ask to save the visible changes, or use Save changes. Nothing was saved.");
  const approval = result.data;
  if (!isStandaloneSaveRequest(approval.utterance) && !approval.additionsApplied) throw new GudActionError("Prepare the requested addition before saving. Nothing was saved.");
  if (now - approval.capturedAt > 120000 || approval.capturedAt > now + 5000) throw new GudActionError("That save request expired. Review the drafts and ask to save again.");
  if (!approval.drafts.length) throw new GudActionError("No reviewed drafts were present when you asked. Review the new draft, then ask to save it.");
  if (approval.drafts.length > 1 && !/\b(?:all|changes|drafts)\b/i.test(approval.utterance)) throw new GudActionError("Several drafts are open. Say 'save all drafts' or save the selection in the app.");
  if (new Set(requested).size !== requested.length || requested.length !== approval.drafts.length || requested.some(id => !approval.drafts.some(d => d.id === id))) throw new GudActionError("The draft selection changed. Review it and ask to save again.");
  return approval.drafts;
}
