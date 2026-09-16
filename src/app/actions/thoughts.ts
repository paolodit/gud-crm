"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { getCurrentMember } from "@/lib/session";
import { assertPrivateThoughtAccess, ThoughtsError } from "@/lib/domain/thoughts";
import { appendThoughtExploration, getThought, listThoughtExplorations, listThoughts, reserveThoughtExploration, saveThought } from "@/lib/data/thoughts-repository";
import { generateThoughtExploration, thoughtOutline, thoughtsAiEnabled } from "@/lib/ai/thoughts";

async function privateMember() {
  const actor = await getCurrentMember();
  if (!actor) throw new ThoughtsError("Sign in to your own account to open Thoughts.");
  assertPrivateThoughtAccess({ demoMode: actor.demoMode, publicDemo: env.publicDemo, impersonated: actor.impersonated });
  return actor;
}
function safeError(error: unknown) {
  if (error instanceof ThoughtsError) return error.message;
  if (error instanceof z.ZodError) return "Check your thought: add some text and keep within the field limits.";
  // Never put private notes, provider errors or database queries into shared logs.
  return "Thoughts could not complete that request. Your draft is still here; please try again.";
}
export async function loadThoughtsAction() {
  try {
    const actor = await privateMember();
    const [thoughts, explorations, aiEnabled] = await Promise.all([listThoughts(actor), listThoughtExplorations(actor), thoughtsAiEnabled(actor)]);
    return { ok: true as const, thoughts, explorations, aiEnabled, local: actor.storageMode === "sqlite", preferencesKey: `gud-thoughts-view:${actor.organisationId}:${actor.id}` };
  } catch (error) { return { ok: false as const, error: safeError(error) }; }
}
export async function saveThoughtAction(input: unknown) {
  try {
    const actor = await privateMember();
    const thought = await saveThought(actor, input);
    revalidatePath("/thoughts");
    return { ok: true as const, thought };
  } catch (error) { return { ok: false as const, error: safeError(error) }; }
}
export async function exploreThoughtAction(input: unknown) {
  try {
    const actor = await privateMember();
    const parsed = z.object({ id: z.uuid(), mode: z.enum(["outline", "ai"]), research: z.boolean().default(false), direction: z.string().trim().max(4000).default("") }).strict().parse(input);
    const thought = await getThought(actor, parsed.id);
    if (parsed.mode === "ai" && !(await thoughtsAiEnabled(actor))) throw new ThoughtsError("AI exploration is unavailable. Enable OpenAI in Settings or create a private thinking outline.");
    if (!(await reserveThoughtExploration(actor))) throw new ThoughtsError("You have reached the short-term exploration limit. Try again in 15 minutes.");
    const document = parsed.mode === "outline" ? thoughtOutline(thought, parsed.direction) : await generateThoughtExploration(thought, parsed.research, parsed.direction);
    const exploration = await appendThoughtExploration(actor, thought.id, document, parsed.mode === "outline" ? "outline" : "openai", parsed.mode === "ai" && document.sources.length > 0, thought);
    revalidatePath("/thoughts");
    return { ok: true as const, exploration };
  } catch (error) { return { ok: false as const, error: safeError(error) }; }
}
