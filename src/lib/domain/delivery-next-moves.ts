import type { BoardSnapshot } from "./types";
import { liveProjectRecords } from "./delivery";

export function deliveryNextMoves(snapshot: BoardSnapshot, memberId: string, offerId = "all") {
  const today = snapshot.generatedAt.slice(0, 10);
  return liveProjectRecords(snapshot)
    .filter((project) => !project.delivery.archivedAt && project.delivery.stage !== "complete")
    .filter((project) => snapshot.demoMode || project.ownerId === memberId)
    .filter((project) => offerId === "all" || project.offerId === offerId)
    .map((project) => {
      const { dueDate, nextMilestone } = project.delivery;
      const overdue = Boolean(dueDate && dueDate < today);
      const missing = !nextMilestone.trim();
      const priority = overdue ? 0 : missing ? 1 : dueDate === today ? 2 : dueDate ? 3 : 4;
      const timing = overdue ? `Overdue · ${dueDate}` : dueDate === today ? "Due today" : dueDate ? `Due ${dueDate}` : "Set a milestone date";
      return { project, priority, overdue, title: missing ? "Set the next milestone" : nextMilestone, timing };
    })
    .sort((a, b) => a.priority - b.priority || (a.project.delivery.dueDate ?? "9999").localeCompare(b.project.delivery.dueDate ?? "9999") || a.project.companyName.localeCompare(b.project.companyName));
}
