import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendThoughtExploration, getThought, listThoughtExplorations, listThoughts, saveThought } from "@/lib/data/thoughts-repository";
import { explorationDocumentSchema, thoughtWriteSchema, type ThoughtActor } from "@/lib/domain/thoughts";
import { THOUGHTS_READ_SCOPE, THOUGHTS_WRITE_SCOPE } from "./scopes";

export const THOUGHT_TOOL_NAMES = ["list_thoughts", "get_thought", "save_thought", "list_thought_explorations", "save_thought_exploration"] as const;
export function registerThoughtTools(server: McpServer, actor: ThoughtActor, scopes: string[]) {
  if (!scopes.includes(THOUGHTS_READ_SCOPE)) return;
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const outputSchema = { result: z.unknown() };
  async function result(fn: () => Promise<unknown>, mutation = false) {
    if (mutation && !scopes.includes(THOUGHTS_WRITE_SCOPE)) return { isError: true, content: [{ type: "text" as const, text: "This connection needs separate gud:thoughts:write consent." }] };
    try {
      const value = await fn();
      return { structuredContent: { result: value }, content: [{ type: "text" as const, text: JSON.stringify(value) }] };
    } catch { return { isError: true, content: [{ type: "text" as const, text: "Private thought unavailable, invalid input or stale version. Read your own current record and try again." }] }; }
  }
  server.registerTool("list_thoughts", { title: "List my private Thoughts", description: "Personal notes belonging only to the signed-in user. Never copy them into shared CRM records without explicit permission. Excludes archived notes by default.", inputSchema: { includeArchived: z.boolean().default(false) }, outputSchema, annotations: read }, ({ includeArchived }) => result(async () => (await listThoughts(actor)).filter((item) => includeArchived || !item.archived)));
  server.registerTool("get_thought", { title: "Read my private thought", description: "Read one owned thought and its version before updating it. Other users' notes are inaccessible, even to admins.", inputSchema: { id: z.uuid() }, outputSchema, annotations: read }, ({ id }) => result(() => getThought(actor, id)));
  server.registerTool("save_thought", { title: "Save my private thought", description: "Create, edit, move, archive or restore a personal thought. For updates supply its current version and full content, preserving unspecified content. Confirm archiving with the user. No owner override and no shared CRM writes.", inputSchema: thoughtWriteSchema.shape, outputSchema, annotations: { ...write, destructiveHint: true } }, (input) => result(() => saveThought(actor, input), true));
  server.registerTool("list_thought_explorations", { title: "List my private explorations", description: "Read the signed-in user's private exploration library; optionally filter by their thought ID.", inputSchema: { thoughtId: z.uuid().optional() }, outputSchema, annotations: read }, ({ thoughtId }) => result(async () => { if (thoughtId) await getThought(actor, thoughtId); return (await listThoughtExplorations(actor)).filter((item) => !thoughtId || item.thoughtId === thoughtId); }));
  server.registerTool("save_thought_exploration", { title: "Append a private exploration", description: "Save an exploration requested by the user as a new document without expanding the original note. Label evidence and assumptions; cite sources accurately. Origin is recorded as external MCP, not verified GUD research.", inputSchema: { thoughtId: z.uuid(), document: explorationDocumentSchema }, outputSchema, annotations: write }, ({ thoughtId, document }) => result(() => appendThoughtExploration(actor, thoughtId, document, "mcp"), true));
}
