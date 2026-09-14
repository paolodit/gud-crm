import { z } from "zod";
import type { LiveProject } from "./delivery";

export const liveOrderSchema = z.object({
  projectId: z.uuid(), toStageId: z.string().min(1).max(80),
  overProjectId: z.uuid().nullable(), placement: z.enum(["before", "after"]),
});
export type LiveOrder = z.infer<typeof liveOrderSchema>;

/** Work with the full current board, never just the filtered client subset. */
export function moveLiveProject(records: LiveProject[], move: LiveOrder): LiveProject[] {
  const current = records.find((item) => item.id === move.projectId && !item.delivery.archivedAt);
  if (!current) throw new Error("This project is no longer on the live board.");
  if (move.overProjectId === current.id) return records;
  const target = records.filter((item) => item.id !== current.id && item.delivery.stage === move.toStageId && !item.delivery.archivedAt)
    .sort((a, b) => (a.delivery.position ?? Number.MAX_SAFE_INTEGER) - (b.delivery.position ?? Number.MAX_SAFE_INTEGER));
  const anchor = move.overProjectId ? target.findIndex((item) => item.id === move.overProjectId) : -1;
  if (move.overProjectId && anchor < 0) throw new Error("The destination changed. Refresh the board and try again.");
  target.splice(anchor < 0 ? target.length : anchor + (move.placement === "after" ? 1 : 0), 0, current);
  const positions = new Map(target.map((item, index) => [item.id, (index + 1) * 1000]));
  return records.map((item) => positions.has(item.id) ? { ...item, delivery: { ...item.delivery, stage: move.toStageId, position: positions.get(item.id)! } } : item);
}
