import { describe, expect, it } from "vitest";
import { ConversationBodyTooLarge, readConversationBody } from "./request-body";

describe("conversation request size", () => {
  it("accepts bounded JSON and counts UTF-8 bytes rather than characters", async () => {
    expect(await readConversationBody(new Request("https://fixture.test", { method: "POST", body: '{"op":"load"}' }))).toBe('{"op":"load"}');
    await expect(readConversationBody(new Request("https://fixture.test", { method: "POST", body: "£££" }), 5)).rejects.toBeInstanceOf(ConversationBodyTooLarge);
  });
  it("rejects declared or chunked oversize bodies without consuming all chunks", async () => {
    await expect(readConversationBody(new Request("https://fixture.test", { method: "POST", headers: { "content-length": "100001" }, body: "{}" }))).rejects.toBeInstanceOf(ConversationBodyTooLarge);
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(60000)); }, cancel() { cancelled = true; } });
    const request = new Request("https://fixture.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readConversationBody(request)).rejects.toBeInstanceOf(ConversationBodyTooLarge);
    expect(cancelled).toBe(true);
  });
});
