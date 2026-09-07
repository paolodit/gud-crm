import { z } from "zod";
import type { OpportunitySummary, StageSummary } from "./types";

export const deliveryStages = [
  { id: "kickoff", name: "Kickoff", colour: "#007bff", description: "Agree the brief, people and first milestone." },
  { id: "in_progress", name: "In progress", colour: "#6554c0", description: "The team is actively delivering the work." },
  { id: "client_review", name: "Client review", colour: "#d99000", description: "Waiting for feedback or approval." },
  { id: "on_hold", name: "On hold", colour: "#64748b", description: "Paused, with a clear reason and next move." },
  { id: "complete", name: "Complete", colour: "#008664", description: "Delivered and handed over." },
] as const;

export const deliverySchema = z.object({
  stage: z.enum(["kickoff", "in_progress", "client_review", "on_hold", "complete"]).default("kickoff"),
  dueDate: z.iso.date().nullable().default(null),
  nextMilestone: z.string().trim().max(240).default(""),
  notes: z.string().trim().max(10_000).default(""),
});
export type DeliveryDetails = z.infer<typeof deliverySchema>;
export const deliveryPatchSchema = z.object({
  stage: z.enum(["kickoff", "in_progress", "client_review", "on_hold", "complete"]).optional(),
  dueDate: z.iso.date().nullable().optional(),
  nextMilestone: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(10_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one delivery field.");
export const deliveryUpdateSchema = z.object({ opportunityId: z.uuid(), delivery: deliveryPatchSchema });

export function deliveryDetails(value: unknown): DeliveryDetails {
  const parsed = deliverySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : deliverySchema.parse({});
}

export function getLiveProjects(opportunities: OpportunitySummary[], stages: StageSummary[]) {
  const won = new Set(stages.filter((stage) => stage.terminalType === "won").map((stage) => stage.id));
  return opportunities.filter((item) => won.has(item.stageId) && !item.archivedAt && !item.company.archivedAt);
}
