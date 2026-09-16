import { describe, expect, it } from "vitest";
import { acknowledgeEdits, SignOffPlayback } from "./client-state";

describe("conversation client state", () => {
  it("acknowledges one draft without losing another draft or newer typing", () => {
    expect(acknowledgeEdits({ a: { title: "Newer", value: 6200 }, b: { note: "Retry me" } }, "a", { title: "Older", value: 6200 }))
      .toEqual({ a: { title: "Newer" }, b: { note: "Retry me" } });
    expect(acknowledgeEdits({ a: { title: "Done" }, b: { note: "Retry me" } }, "a", { title: "Done" }))
      .toEqual({ b: { note: "Retry me" } });
  });
  it("waits for the tagged successful sign-off and its own audio drain", () => {
    const state = new SignOffPlayback(); state.arm("finish-1");
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "older" })).toBe(false);
    expect(state.observe({ type: "response.created", response: { id: "final", metadata: { gud_finish: "finish-1" } } })).toBe(false);
    expect(state.observe({ type: "response.done", response: { id: "final", status: "completed", metadata: { gud_finish: "finish-1" } } })).toBe(false);
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "older" })).toBe(false);
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "final" })).toBe(true);
    state.reset();
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "final" })).toBe(false);
  });
  it("never treats cancelled, untagged or previous-session audio as the sign-off", () => {
    const state = new SignOffPlayback(); state.arm("new");
    expect(state.observe({ type: "response.done", response: { id: "old", status: "completed", metadata: { gud_finish: "old" } } })).toBe(false);
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "old" })).toBe(false);
    expect(state.observe({ type: "response.done", response: { id: "new", status: "cancelled", metadata: { gud_finish: "new" } } })).toBe(false);
    expect(state.observe({ type: "output_audio_buffer.stopped", response_id: "new" })).toBe(false);
  });
});
