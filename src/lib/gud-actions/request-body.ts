export class ConversationBodyTooLarge extends Error {}

export async function readConversationBody(request: Request, limit = 100_000) {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new ConversationBodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ConversationBodyTooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
