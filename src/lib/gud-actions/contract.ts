import { z } from "zod";

export const screens = { pipeline: "/pipeline", projects: "/live", tasks: "/my-work", thoughts: "/thoughts", companies: "/companies" } as const;
export const recordSchema = z.object({ kind: z.enum(["lead", "project"]), id: z.uuid() }).strict();
export type GudRecord = z.infer<typeof recordSchema>;
export const fieldsSchema = z.object({
  company: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  contact: z.string().trim().max(160).optional(),
  value: z.number().min(0).max(9_999_999_999.99).multipleOf(0.01).optional(),
  offerId: z.uuid().optional(),
  stageId: z.string().min(1).max(80).optional(),
  note: z.string().trim().max(5000).optional(),
  task: z.string().trim().max(240).optional(),
  dueDate: z.iso.date().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  completeTaskIds: z.array(z.uuid()).max(10).optional(),
  body: z.string().max(20000).optional(),
}).strict();
export type GudFields = z.infer<typeof fieldsSchema>;
export const draftInputSchema = z.object({
  kind: z.enum(["lead", "project", "thought"]), targetId: z.uuid().optional(),
  fields: fieldsSchema, timezone: z.string().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict();
export type GudDraftInput = z.infer<typeof draftInputSchema>;
export type GudDraft = GudDraftInput & { id: string; version: number; label: string; status: "draft" | "saved" | "cancelled"; expiresAt: string; warnings: string[]; baseline: string; taskOptions?: Array<{ id: string; title: string }>; result?: { href: string; label: string } };
export class GudActionError extends Error {}
export function recordHref(record: GudRecord) { return `${record.kind === "lead" ? "/pipeline?opportunity=" : "/live?project="}${encodeURIComponent(record.id)}`; }
export function signOff(saved: boolean, unsaved: number) {
  return unsaved ? "Your changes are still in draft. Save or cancel them when you’re ready." : saved ? "Saved. All Gud." : "All Gud. Nothing changed.";
}
export function assertFieldScope(input: GudDraftInput) {
  const permitted: Record<GudDraftInput["kind"], Array<keyof GudFields>> = {
    lead: ["company", "title", "contact", "value", "offerId", "stageId", "note", "task", "dueDate", "dueTime", "completeTaskIds"],
    project: ["company", "title", "value", "stageId", "note", "task", "dueDate", "completeTaskIds"],
    thought: ["title", "body"],
  };
  if (Object.keys(input.fields).some((key) => !permitted[input.kind].includes(key as keyof GudFields))) throw new GudActionError("Some fields do not belong to this kind of record. Nothing was staged.");
  if (input.kind === "thought" && input.targetId) throw new GudActionError("This prototype creates private Thoughts. Use the Thought editor to update an existing one.");
  if (input.kind === "lead" && input.targetId && (input.fields.company !== undefined || input.fields.contact !== undefined)) throw new GudActionError("Use the contact/company editor to change an existing lead’s people. Other changes remain in draft.");
}

const nullableFields = z.object(Object.fromEntries(Object.entries(fieldsSchema.shape).map(([key, value]) => [key, value.unwrap().nullable()])));
export const toolArguments = {
  navigate: z.object({ screen: z.enum(["pipeline", "projects", "tasks", "thoughts", "companies"]) }).strict(),
  search: z.object({ query: z.string().trim().min(2).max(120), kind: z.enum(["all", "lead", "project"]) }).strict(),
  open_record: recordSchema,
  stage_change: z.object({ kind: z.enum(["lead", "project", "thought"]), targetId: z.uuid().nullable(), draftId: z.uuid().nullable(), version: z.number().int().positive().nullable(), fields: nullableFields }).strict(),
  finish_conversation: z.object({}).strict(),
};
export const actionTools = Object.entries(toolArguments).map(([name, schema]) => ({ type: "function" as const, name, description: ({
  navigate: "Open a GUD screen. Does not save or discard drafts.",
  search: "Find existing leads and projects by company, title or linked contact. Returns limited matches; clarify ambiguous names. Never search private Thoughts.",
  open_record: "Open/read the exact selected lead/project, including available tasks. Use before staging updates. Does not mutate it.",
  stage_change: "Prepare a visible editable draft, NOT a save. For a new record use null targetId. To revise a draft use its returned draftId/version and supply only changed fields (all other fields null). Existing target needs open_record first. A task on a project is a checklist item: it has no individual due date. dueDate on projects is the project milestone date. No delete, archive, terminal sales moves, emails or invoice sending. Thought creation accepts title/body only.",
  finish_conversation: "Request sign-off. Pending drafts remain unsaved; never infer that 'that is it' authorizes saving. User must use Save changes.",
} as Record<string, string>)[name], parameters: z.toJSONSchema(schema, { target: "draft-7" }) }));
