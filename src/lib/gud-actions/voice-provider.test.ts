import { describe, expect, it, vi } from "vitest";
import { createVoiceConnection, liveInstructions, voiceAdapterForCall, voiceHangupUrl } from "./voice-provider";

const options = { adapter: "live" as const, apiKey: "fixture-key", sdp: "fixture-offer", voice: "marin" as const, pace: "quick" as const, realtimeModel: "gpt-realtime-2.1", backendModel: "gpt-5.6-luna", instructions: "CRM business rules and references", tools: [{ type: "function", name: "search", parameters: {} }] };
describe("voice provider adapter", () => {
  it("uses Live JSON, independent backend, existing tools, private non-stored sessions", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: { id: "opaque/unchanged:123" }, transport: { type: "webrtc", sdp: "answer" } })));
    const result = await createVoiceConnection(options, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/live/sessions");
    const body = JSON.parse(request.body);
    expect(body.session).toMatchObject({ model: "gpt-live-1", store: false, audio: { output: { voice: "marin" } }, delegation: { type: "responses", responses: { model: options.backendModel, parallel_tool_calls: false, tools: [{ name: "search", strict: false }] } } });
    expect(body.session.audio.input).toBeUndefined();
    expect(body.session.client.data_channel.allowed_client_events).not.toContain("session.update");
    expect(body.session.client.data_channel.allowed_client_events).toContain("response.item.create");
    expect(body.session.delegation.responses.instructions).toContain(options.instructions);
    expect(body.transport).toEqual({ type: "webrtc", sdp: options.sdp });
    expect(result).toEqual({ adapter: "live", callId: "gud-live:opaque/unchanged:123", sdp: "answer" });
    expect(JSON.stringify(result)).not.toContain(options.apiKey);
    expect(voiceHangupUrl(result.callId)).toBe("https://api.openai.com/v1/live/sessions/opaque%2Funchanged%3A123/hangup");
  });
  it("keeps Realtime's multipart and VAD contract as an explicit fallback", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("sdp-answer", { headers: { location: "/v1/realtime/calls/rtc_123" } }));
    const result = await createVoiceConnection({ ...options, adapter: "realtime", pace: "relaxed" }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/realtime/calls");
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(JSON.parse(String(form.get("session"))).audio.input.turn_detection.eagerness).toBe("low");
    expect(result).toEqual({ adapter: "realtime", callId: "rtc_123", sdp: "sdp-answer" });
    expect(voiceHangupUrl("rtc_123")).toBe("https://api.openai.com/v1/realtime/calls/rtc_123/hangup");
    expect(voiceAdapterForCall(null)).toBe("realtime");
  });
  it("does not leak provider errors or automatically retry/open another billable session", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private provider detail", { status: 403 }));
    await expect(createVoiceConnection(options, fetcher)).rejects.toThrow("GPT-Live 1 voice could not connect");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("separates conversation policy from detailed business instructions", () => {
    expect(liveInstructions("relaxed")).toContain("Backchannel policy:");
    expect(liveInstructions("relaxed")).toContain("Interruption policy:");
    expect(liveInstructions("relaxed")).toContain("Delegation policy:");
    expect(liveInstructions("relaxed")).toContain("unhurried");
    expect(liveInstructions("quick")).toContain("All Gud");
  });
  it("releases a created Live session if its SDP answer is malformed", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "live_bad_answer" }, transport: {} }))).mockResolvedValueOnce(new Response(null));
    await expect(createVoiceConnection(options, fetcher)).rejects.toThrow("unusable connection answer");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("https://api.openai.com/v1/live/sessions/live_bad_answer/hangup");
  });
});
