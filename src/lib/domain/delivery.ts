import { z } from "zod";
import type { BoardSnapshot, OpportunitySummary, StageSummary } from "./types";

export const deliveryStages = [
  { id: "kickoff", name: "Kickoff", colour: "#007bff", description: "Agree the brief, people and first milestone." },
  { id: "in_progress", name: "In progress", colour: "#6554c0", description: "The team is actively delivering the work." },
  { id: "client_review", name: "Client review", colour: "#d99000", description: "Waiting for feedback or approval." },
  { id: "on_hold", name: "On hold", colour: "#64748b", description: "Paused, with a clear reason and next move." },
  { id: "complete", name: "Complete", colour: "#008664", description: "Delivered and handed over." },
] as const;

export const projectValueSchema = z.number().min(0).max(999_999_999_999.99).multipleOf(0.01);

export const deliverySchema = z.object({
  // GBP agreed delivery value, independent of the sales opportunity's estimate.
  // Optional for existing records; null explicitly clears a previously saved value.
  projectValue: projectValueSchema.nullable().optional(),
  stage: z.string().trim().min(1).max(80).default("kickoff"),
  dueDate: z.iso.date().nullable().default(null),
  nextMilestone: z.string().trim().max(240).default(""),
  notes: z.string().trim().max(10_000).default(""),
  archivedAt: z.iso.datetime().nullable().optional(),
});
export type DeliveryDetails = z.infer<typeof deliverySchema>;
export const deliveryPatchSchema = z.object({
  projectValue: projectValueSchema.nullable().optional(),
  stage: z.string().trim().min(1).max(80).optional(),
  dueDate: z.iso.date().nullable().optional(),
  nextMilestone: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(10_000).optional(),
  archivedAt: z.iso.datetime().nullable().optional(),
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

export const deliveryStageSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type DeliveryStage = z.infer<typeof deliveryStageSchema>;
export const deliveryStageListSchema = z.array(deliveryStageSchema).min(1).max(20)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Stage IDs must be unique.");
export function configuredDeliveryStages(value: unknown): DeliveryStage[] {
  const parsed = deliveryStageListSchema.safeParse(value);
  return parsed.success ? parsed.data : deliveryStages.map((stage) => ({ ...stage }));
}
export const directProjectSchema = z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(200),
  companyName: z.string().trim().min(1).max(200),
  ownerId: z.string().trim().min(1).max(220).nullable(), offerId: z.uuid().nullable(),
  delivery: deliverySchema,
});
export type DirectProject = z.infer<typeof directProjectSchema>;
export function directProjects(value: unknown): DirectProject[] {
  const parsed = z.array(directProjectSchema).safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}
export type LiveProject = DirectProject & { source: "sales" | "direct" };
export function liveProjectRecords(snapshot: BoardSnapshot): LiveProject[] {
  return [
    ...getLiveProjects(snapshot.opportunities, snapshot.stages).map((item): LiveProject => ({ id: item.id, title: item.title, companyName: item.company.name, ownerId: item.owner?.id ?? null, offerId: item.offer?.id ?? null, delivery: deliveryDetails(item.delivery ?? { stage: configuredDeliveryStages(snapshot.deliveryStages)[0].id }), source: "sales" })),
    ...directProjects(snapshot.directProjects).map((item): LiveProject => ({ ...item, source: "direct" })),
  ];
}
