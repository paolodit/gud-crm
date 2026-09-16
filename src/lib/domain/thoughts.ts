import { z } from "zod";

export const thoughtColours = ["butter", "rose", "sage", "sky", "lilac", "peach"] as const;
export const thoughtContentSchema = z.object({
  title: z.string().trim().max(160).default(""),
  body: z.string().max(20000).default(""),
  checklist: z.array(z.object({ id: z.uuid(), text: z.string().trim().min(1).max(500), done: z.boolean() }).strict()).max(100).default([]),
  colour: z.enum(thoughtColours).default("butter"),
  category: z.string().trim().max(60).default(""),
  x: z.number().int().min(0).max(10000).default(24),
  y: z.number().int().min(0).max(10000).default(24),
}).strict().refine((note) => Boolean(note.title || note.body.trim() || note.checklist.length), "Add a thought first.")
  .refine((note) => new Set(note.checklist.map((item) => item.id)).size === note.checklist.length, "Checklist items must have unique IDs.");
export type ThoughtContent = z.infer<typeof thoughtContentSchema>;
export type Thought = ThoughtContent & { id: string; version: number; archived: boolean; createdAt: string; updatedAt: string };
export const thoughtWriteSchema = z.object({ id: z.uuid().optional(), version: z.number().int().positive().optional(), content: thoughtContentSchema, archived: z.boolean().default(false) }).strict();
export type ThoughtWrite = z.infer<typeof thoughtWriteSchema>;
export const explorationDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(60000),
  sources: z.array(z.object({ title: z.string().max(300), url: z.url().refine((url) => /^https?:\/\//i.test(url)), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()).max(100).default([]),
}).strict();
export type ExplorationDocument = z.infer<typeof explorationDocumentSchema>;
export type ThoughtExploration = ExplorationDocument & { id: string; thoughtId: string; thoughtVersion: number; thoughtTitle: string; origin: "outline" | "openai" | "mcp"; researched: boolean; createdAt: string };
export type ThoughtActor = { id: string; organisationId: string };

export class ThoughtsError extends Error {}
export const unavailableThought = () => new ThoughtsError("This thought is unavailable. Reload your board and try again.");
export function assertPrivateThoughtAccess(input: { demoMode?: boolean; publicDemo?: boolean; impersonated?: boolean }) {
  if (input.demoMode || input.publicDemo) throw new ThoughtsError("Private Thoughts needs an individual account. It is unavailable on shared demo logins.");
  if (input.impersonated) throw new ThoughtsError("Private Thoughts cannot be opened while impersonating another user.");
}
export function thoughtLabel(note: ThoughtContent) { return note.title || note.body.trim().split("\n")[0]?.slice(0, 100) || "Untitled thought"; }

/** Voice commands are parsed locally. Nothing is sent to the workspace AI during capture. */
export function thoughtFromSpeech(transcript: string) {
  const explore = /\bexplore (?:that|this)(?: idea)?[.!?]?\s*$/i.test(transcript);
  const cleaned = transcript.replace(/^\s*(?:hey\s+)?(?:gud[,.:]?\s*)?new thought[,.:]?\s*/i, "").replace(/\bexplore (?:that|this)(?: idea)?[.!?]?\s*$/i, "").trim();
  const parts = cleaned.split(/\b(bullet point|bullet|to-do|todo|to do|checklist item)\s*[:,-]?\s*/i);
  let body = parts[0].trim();
  const checklist: ThoughtContent["checklist"] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const text = (parts[index + 1] ?? "").trim();
    if (!text) continue;
    if (/bullet/i.test(parts[index])) body += `${body ? "\n" : ""}• ${text}`;
    else checklist.push({ id: crypto.randomUUID(), text: text.slice(0, 500), done: false });
  }
  return { body, checklist, explore };
}
