import type { GudFields } from "./contract";

export type EditableFields = Omit<GudFields, "value"> & { value?: number | "" };
export type DraftEdits = Record<string, EditableFields>;

// A successful request may acknowledge only the exact values it sent. Keep any
// newer typing, and acknowledge each draft separately so partial failures retry.
export function acknowledgeEdits(current: DraftEdits, id: string, sent: EditableFields): DraftEdits {
  const remaining = { ...current[id] };
  for (const key of Object.keys(sent) as Array<keyof GudFields>) {
    if (JSON.stringify(remaining[key]) === JSON.stringify(sent[key])) delete remaining[key];
  }
  const next = { ...current };
  if (Object.keys(remaining).length) next[id] = remaining;
  else delete next[id];
  return next;
}

// A previous response can finish playing after the finish tool returns. Only
// the specifically tagged sign-off response is allowed to hang up the call.
export class SignOffPlayback {
  private token: string | null = null;
  private responseId: string | null = null;
  private completed = false;
  private drained = false;
  arm(token: string) { this.reset(); this.token = token; }
  reset() { this.token = null; this.responseId = null; this.completed = false; this.drained = false; }
  observe(event: Record<string, unknown>) {
    const response = event.response as { id?: string; status?: string; metadata?: { gud_finish?: string } } | undefined;
    if (this.token && response?.metadata?.gud_finish === this.token && response.id) {
      this.responseId = response.id;
      if (event.type === "response.done") this.completed = response.status === "completed";
    }
    if (this.responseId && event.response_id === this.responseId && event.type === "output_audio_buffer.stopped") this.drained = true;
    return this.completed && this.drained;
  }
}
