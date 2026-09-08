import Link from "next/link";
import type { BoardSnapshot } from "@/lib/domain/types";
import { configuredDeliveryStages, liveProjectRecords } from "@/lib/domain/delivery";

export function LiveReports({ snapshot, offerId }: { snapshot: BoardSnapshot; offerId: string }) {
  const all = liveProjectRecords(snapshot).filter((project) => offerId === "all" || project.offerId === offerId);
  const current = all.filter((project) => !project.delivery.archivedAt);
  const overdue = current.filter((project) => project.delivery.stage !== "complete" && project.delivery.dueDate && project.delivery.dueDate < snapshot.generatedAt.slice(0, 10));
  return <section className="surface report-panel live-reports"><div className="surface-header"><div><h2>Live projects</h2><p>Delivery workload, kept separate from sales performance</p></div><Link className="btn btn-quiet" href="/live">Open live board</Link></div><div className="channel-stats"><div><strong>{current.length}</strong><span>Current projects</span></div><div><strong>{overdue.length}</strong><span>Overdue milestones</span></div><div><strong>{current.filter((project) => !project.delivery.nextMilestone).length}</strong><span>No milestone</span></div><div><strong>{all.length - current.length}</strong><span>Archived</span></div></div><div className="bar-list">{configuredDeliveryStages(snapshot.deliveryStages).map((stage) => { const count = current.filter((project) => project.delivery.stage === stage.id).length; return <div className="bar-row" key={stage.id}><span>{stage.name}</span><div><i style={{ width: `${current.length ? count / current.length * 100 : 0}%`, background: stage.colour }} /></div><strong>{count}</strong></div>; })}</div><p className="settings-hint">{current.filter((project) => project.source === "direct").length} added directly · {current.filter((project) => project.source === "sales").length} from won sales</p></section>;
}
