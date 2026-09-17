import { describe, expect, it } from "vitest";
import { LiveCaptions, VoiceProtocol } from "./voice-protocol";

const envelope = (event: Record<string, unknown>, delegation_id = "delegation-1") => ({ type: "response.event", delegation_id, event });
const ready = () => { const p = new VoiceProtocol("live"); p.incoming({ type: "session.started" }); return p; };
const created = { type: "response.created", response: { id: "response-1" } };
const call = { type: "function_call", name: "stage_change", arguments: '{"kind":"thought","fields":{"title":"Shopping"}}', call_id: "call-1" };
const completed = { type: "response.completed", response: { id: "response-1", status: "completed", output: [], usage: { input_tokens: 12, output_tokens: 6 } } };

describe("Live event adapter", () => {
  it("waits for session.started, not merely an open data channel", () => {
    const p = new VoiceProtocol("live");
    expect(p.opened()).toEqual([]);
    expect(p.outgoing({ type: "response.create" })).toEqual([]);
    expect(p.incoming({ type: "session.started" })).toEqual([{ type: "gud.voice.ready" }]);
    expect(p.incoming({ type: "session.started" })).toEqual([]);
    expect(p.outgoing({ type: "response.create", response: { model: "wrong" }, delegation_id: "wrong" })).toEqual([{ type: "response.create" }]);
  });
  it("collects function output-item events despite empty terminal output, once only", () => {
    const p = ready(); p.incoming(envelope(created));
    expect(p.incoming(envelope({ type: "response.function_call_arguments.done", arguments: call.arguments }))).toEqual([]);
    p.incoming(envelope({ type: "response.output_item.done", item: call }));
    p.incoming(envelope({ type: "response.output_item.done", item: call }));
    expect(p.incoming(envelope(completed))).toEqual([{ type: "response.done", response: { ...completed.response, output: [call] } }]);
    expect(p.incoming(envelope(completed))).toEqual([]);
  });
  it("does not execute failed, incomplete, mismatched or unwrapped responses", () => {
    for (const type of ["response.failed", "response.incomplete", "response.cancelled"]) {
      const p = ready(); p.incoming(envelope(created)); p.incoming(envelope({ type: "response.output_item.done", item: call }));
      expect(p.incoming(envelope({ ...completed, type }))).toMatchObject([{ type: "error" }, { response: { status: "failed", output: [] } }]);
    }
    const p = ready(); p.incoming(envelope(created));
    expect(p.incoming(envelope(completed, "wrong-delegation"))).toEqual([]);
    expect(p.incoming({ type: "response.done", response: { status: "completed", output: [call] } })).toEqual([]);
    expect(p.incoming(envelope({ type: "response.output_item.done", item: call }, "wrong-delegation"))).toEqual([]);
    expect(p.incoming(envelope(completed))[0]).toMatchObject({ response: { output: [] } });
  });
  it("keeps concurrent delegations separate", () => {
    const p = ready(); p.incoming(envelope(created));
    p.incoming(envelope({ type: "response.created", response: { id: "response-2" } }, "delegation-2"));
    p.incoming(envelope({ type: "response.output_item.done", item: { ...call, call_id: "call-2" } }, "delegation-2"));
    expect(p.incoming(envelope(completed))[0]).toMatchObject({ response: { output: [] } });
    expect(p.incoming(envelope({ type: "response.completed", response: { id: "response-2", status: "completed" } }, "delegation-2"))[0]).toMatchObject({ response: { output: [{ call_id: "call-2" }] } });
  });
  it("sends speech instructions and tool results on their proper Live channels", () => {
    const p = ready();
    expect(p.outgoing({ type: "response.create", response: { instructions: "Say All Gud", tool_choice: "none" } })[0]).toMatchObject({ type: "session.instructions.append", delegation_id: null, content: "Say All Gud" });
    expect(p.outgoing({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "call-1", output: "{}" } })).toEqual([{ type: "response.item.create", item: { type: "function_call_output", call_id: "call-1", output: "{}" } }]);
    expect(p.outgoing({ type: "response.cancel" })).toEqual([]);
    expect(p.outgoing({ type: "gud.input.mute" })[0].type).toBe("session.input_audio.mute");
    expect(p.outgoing({ type: "gud.input.unmute" })[0].type).toBe("session.input_audio.unmute");
  });
  it("never manufactures completed Save approval or playback events from captions", () => {
    const p = ready();
    expect(p.incoming({ type: "session.input_transcript.delta", delta: "Save", start_ms: 0, end_ms: 100 })).toMatchObject([{ type: "gud.caption", role: "user" }]);
    expect(p.incoming({ type: "session.output_transcript.delta", delta: "All Gud", start_ms: 0, end_ms: 100 })).toMatchObject([{ type: "gud.caption", role: "assistant" }]);
    expect(p.incoming({ type: "session.usage.updated", usage: { seconds: 12 } })).toEqual([{ type: "gud.voice.usage", usage: { seconds: 12 } }]);
    expect(p.incoming({ type: "session.closed", usage: { seconds: 13 }, reason: "close_requested" })[0]).toMatchObject({ type: "gud.voice.closed" });
    expect(p.outgoing({ type: "response.create" })).toEqual([]);
  });
  it("preserves the legacy Realtime wire protocol", () => {
    const p = new VoiceProtocol("realtime"); expect(p.opened()).toHaveLength(1);
    expect(p.incoming(created)).toEqual([created]);
    expect(p.outgoing({ type: "response.cancel", response_id: "r1" })).toEqual([{ type: "response.cancel", response_id: "r1" }]);
  });
});

describe("Live captions", () => {
  it("preserves spaces, repeats and overlapping speakers in stable independent rows", () => {
    const c = new LiveCaptions();
    const a = c.append({ type: "gud.caption", role: "user", delta: "No, ", start_ms: 0, end_ms: 100 })!;
    const b = c.append({ type: "gud.caption", role: "assistant", delta: "Okay", start_ms: 50, end_ms: 200 })!;
    const a2 = c.append({ type: "gud.caption", role: "user", delta: "no, BHBI", start_ms: 100, end_ms: 500 })!;
    expect(a2).toEqual({ id: a.id, role: "user", content: "No, no, BHBI" }); expect(b.id).not.toBe(a.id);
    const newRow = c.append({ type: "gud.caption", role: "user", delta: "Next", start_ms: 5000, end_ms: 5100 })!;
    const late = c.append({ type: "gud.caption", role: "user", delta: ".", start_ms: 500, end_ms: 600 })!;
    expect(late.id).toBe(a.id); expect(newRow.id).not.toBe(a.id);
  });
});
