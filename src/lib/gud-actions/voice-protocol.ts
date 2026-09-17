import type { VoiceAdapter } from "./voice-provider";

export type VoiceEvent = { type: string; [key: string]: unknown };
type Call = { type: "function_call"; name: string; arguments: string; call_id: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The wire protocols differ; only completed backend work reaches the action loop. */
export class VoiceProtocol {
  ready = false;
  private responses = new Map<string, { delegationId: string; calls: Call[]; invalid?: boolean }>();
  private finished = new Set<string>();
  constructor(readonly adapter: VoiceAdapter) {}

  opened(): VoiceEvent[] {
    if (this.adapter === "live") return [];
    this.ready = true;
    return [{ type: "gud.voice.ready" }];
  }

  outgoing(event: VoiceEvent): VoiceEvent[] {
    if (!this.ready) return [];
    if (this.adapter === "realtime") return event.type.startsWith("gud.") ? [] : [event];
    if (event.type === "conversation.item.create") {
      const item = object(event.item);
      if (item.type === "function_call_output") return [{ type: "response.item.create", item }];
      const content = Array.isArray(item.content) ? item.content.map(part => String(object(part).text ?? "")).join("") : "";
      // Only app-authored page/selection context uses this path. No synthetic user turn.
      return [
        { type: "response.item.create", item: { type: "message", role: "developer", content: [{ type: "input_text", text: content }] } },
        { type: "session.thinking.append", delegation_id: null, content: content.slice(0, 1000) },
      ];
    }
    if (event.type === "response.create") {
      const response = object(event.response);
      if (typeof response.instructions === "string") return [{ type: "session.instructions.append", event_id: crypto.randomUUID(), delegation_id: null, content: response.instructions.slice(0, 1000) }];
      // Live accepts no response body or delegation ID here. This continues backend work, not speech.
      return [{ type: "response.create" }];
    }
    if (event.type === "response.cancel") return [];// No Live cancellation equivalent; the application still blocks late actions.
    if (event.type === "gud.input.mute" || event.type === "gud.input.unmute") return [{ type: event.type === "gud.input.mute" ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: crypto.randomUUID() }];
    if (event.type === "session.close") return [event];
    return [];
  }

  incoming(value: Record<string, unknown>): VoiceEvent[] {
    if (typeof value.type !== "string") return [];
    if (this.adapter === "realtime") return [value as VoiceEvent];
    if (value.type === "session.started") {
      if (this.ready) return [];
      this.ready = true;
      return [{ type: "gud.voice.ready" }];
    }
    if (value.type === "session.closed") {
      this.ready = false;
      this.responses.clear();
      return [{ type: "gud.voice.closed", usage: value.usage, reason: value.reason }];
    }
    if (!this.ready) return [];
    if (value.type === "session.input_transcript.delta" || value.type === "session.output_transcript.delta") {
      if (typeof value.delta !== "string" || typeof value.start_ms !== "number" || typeof value.end_ms !== "number") return [];
      return [{ ...value, type: "gud.caption", role: value.type === "session.input_transcript.delta" ? "user" : "assistant" }];
    }
    if (value.type === "session.usage.updated") return [{ type: "gud.voice.usage", usage: value.usage }];
    if (value.type === "error") return [value as VoiceEvent];
    if (value.type !== "response.event" || typeof value.delegation_id !== "string") return [];
    const event = object(value.event), response = object(event.response);
    const id = typeof response.id === "string" ? response.id : undefined;
    if (event.type === "response.created" && id && !this.finished.has(id)) {
      if (this.responses.size >= 8) return [{ type: "error" }];
      if (!this.responses.has(id)) this.responses.set(id, { delegationId: value.delegation_id, calls: [] });
      return [{ type: "response.created", response: { id } }];
    }
    const entries = [...this.responses.entries()].filter(([, pending]) => pending.delegationId === value.delegation_id);
    if (event.type === "response.output_item.done") {
      // A response output-item event has no response ID. Only accept an unambiguous active delegation.
      if (entries.length !== 1) return [];
      const item = object(event.item), pending = entries[0][1];
      if (item.type !== "function_call" || typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") return [];
      if (pending.calls.some(call => call.call_id === item.call_id)) return [];
      if (pending.calls.length >= 8 || item.arguments.length > 80000) { pending.invalid = true; return [{ type: "error" }]; }
      pending.calls.push(item as Call);
      return [];
    }
    if (!["response.completed", "response.failed", "response.incomplete", "response.cancelled"].includes(String(event.type)) || !id) return [];
    const pending = this.responses.get(id);
    if (!pending || pending.delegationId !== value.delegation_id || this.finished.has(id)) return [];
    this.responses.delete(id); this.finished.add(id);
    if (this.finished.size > 256) this.finished.delete(this.finished.values().next().value!);
    const completed = event.type === "response.completed" && response.status === "completed" && !pending.invalid;
    return [
      ...(!completed ? [{ type: "error" }] : []),
      { type: "response.done", response: { id, status: completed ? "completed" : "failed", output: completed ? pending.calls : [], usage: response.usage } },
    ];
  }
}

type Fragment = { delta: string; start: number; end: number };
/** Display grouping only: never used to authorize saves or trigger actions. */
export class LiveCaptions {
  private rows: Array<{ id: string; role: "user" | "assistant"; fragments: Fragment[] }> = [];
  private events = new Set<string>();
  append(event: VoiceEvent) {
    const role: "user" | "assistant" = event.role === "user" ? "user" : "assistant";
    if (typeof event.delta !== "string" || typeof event.start_ms !== "number" || typeof event.end_ms !== "number") return;
    if (typeof event.event_id === "string") {
      if (this.events.has(event.event_id)) return;
      this.events.add(event.event_id);
      if (this.events.size > 4000) this.events.delete(this.events.values().next().value!);
    }
    const start = event.start_ms, end = event.end_ms;
    let row = this.rows.findLast(row => row.role === role && row.fragments.some(part => start <= part.end + 1500 && end >= part.start - 1500));
    if (!row) { row = { id: crypto.randomUUID(), role, fragments: [] }; this.rows.push(row); }
    row.fragments.push({ delta: event.delta, start, end });
    if (row.fragments.length > 2000) row.fragments.shift();
    if (this.rows.length > 30) this.rows.shift();
    return { id: row.id, role, content: row.fragments.map(part => part.delta).join("") };
  }
}

export async function waitForIce(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); connection.removeEventListener("icegatheringstatechange", changed); };
    const changed = () => { if (connection.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out while preparing the network. Please retry.")); }, 10000);
    connection.addEventListener("icegatheringstatechange", changed); changed();
  });
}

/** Local level indicator only. No second capture, recording, or provider request. */
export function monitorMicrophone(stream: MediaStream, changed: (active: boolean) => void) {
  if (typeof AudioContext === "undefined") return () => {};
  const context = new AudioContext(), analyser = context.createAnalyser();
  analyser.fftSize = 512;
  let source: MediaStreamAudioSourceNode;
  try { source = context.createMediaStreamSource(stream); source.connect(analyser); }
  catch (error) { void context.close().catch(() => {}); throw error; }
  const samples = new Float32Array(analyser.fftSize);
  let last = false, lastSound = 0;
  void context.resume().catch(() => {});
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const enabled = stream.getAudioTracks().some(track => track.enabled && track.readyState === "live");
    if (enabled && Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length) > 0.025) lastSound = Date.now();
    const active = enabled && Date.now() - lastSound < 250;
    if (active !== last) { last = active; changed(active); }
  }, 100);
  return () => { clearInterval(timer); source.disconnect(); void context.close().catch(() => {}); };
}
