import { z } from "zod";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";
import { ConversationBodyTooLarge, readConversationBody } from "@/lib/gud-actions/request-body";
import { actionReferences, assertConversationActor, cancelDraft, commitDrafts, editDraft, listDrafts } from "@/lib/gud-actions/service";
import { connectRealtime, contextSchema, endConversation, executeConversationTool, recordUsage, safeConversationError, startConversation, textConversation } from "@/lib/gud-actions/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(env.NEXT_PUBLIC_APP_URL).origin) return Response.json({ error: "Untrusted origin." }, { status: 403 });
  const actor = await getCurrentMember();
  if (!actor) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    assertConversationActor(actor);
    const text = await readConversationBody(request);
    const data = z.object({ op: z.string(), sessionId: z.uuid().optional(), input: z.unknown().optional() }).strict().parse(JSON.parse(text));
    if (data.op === "load") return Response.json({ drafts: await listDrafts(actor), references: await actionReferences(actor) });
    if (data.op === "start") return Response.json({ session: await startConversation(actor), drafts: await listDrafts(actor), references: await actionReferences(actor) });
    if (data.op === "save") return Response.json({ receipts: await commitDrafts(actor, data.input), drafts: await listDrafts(actor) });
    if (data.op === "edit") {
      const input = z.object({ id: z.uuid(), version: z.number().int().positive(), fields: z.unknown() }).strict().parse(data.input);
      return Response.json({ draft: await editDraft(actor, input.id, input.version, input.fields) });
    }
    if (data.op === "cancel") { const input = z.object({ id: z.uuid(), version: z.number().int().positive() }).strict().parse(data.input); await cancelDraft(actor, input.id, input.version); return Response.json({ drafts: await listDrafts(actor) }); }
    const sessionId = z.uuid().parse(data.sessionId);
    if (data.op === "end") { await endConversation(actor, sessionId); return Response.json({ ok: true }); }
    if (data.op === "usage") { await recordUsage(actor, sessionId, data.input); return Response.json({ ok: true }); }
    if (data.op === "voice") { const input = z.object({ sdp: z.string().min(10).max(30000), context: contextSchema }).strict().parse(data.input); return Response.json(await connectRealtime(actor, sessionId, input.sdp, input.context)); }
    if (data.op === "tool") { const input = z.object({ name: z.string().max(80), arguments: z.unknown(), context: contextSchema }).strict().parse(data.input); return Response.json(await executeConversationTool(actor, sessionId, input.name, input.arguments, input.context.timezone)); }
    if (data.op === "text") { const input = z.object({ history: z.unknown(), context: contextSchema }).strict().parse(data.input); return Response.json(await textConversation(actor, sessionId, input.history, input.context)); }
    return Response.json({ error: "Unknown conversation operation." }, { status: 400 });
  } catch (error) {
    if (error instanceof ConversationBodyTooLarge) return Response.json({ error: "Conversation request too large." }, { status: 413 });
    return Response.json({ error: safeConversationError(error) }, { status: 400 });
  }
}
