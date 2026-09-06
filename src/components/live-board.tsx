"use client";

import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowUpRight, CalendarDays, Check, GripVertical, LoaderCircle, Rocket, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { updateDeliveryAction } from "@/app/actions/delivery";
import { deliveryDetails, deliveryStages, getLiveProjects, type DeliveryDetails } from "@/lib/domain/delivery";
import type { BoardSnapshot, OpportunitySummary } from "@/lib/domain/types";
import { useDialogFocus } from "./use-dialog-focus";

export function LiveBoard({ snapshot }: { snapshot: BoardSnapshot }) {
  const [records, setRecords] = useState(snapshot.opportunities);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => { queueMicrotask(() => setRecords(snapshot.opportunities)); }, [snapshot.opportunities]);
  const all = getLiveProjects(records, snapshot.stages);
  const visible = all.filter((item) => (owner === "all" || item.owner?.id === owner) && `${item.company.name} ${item.title} ${deliveryDetails(item.delivery).nextMilestone}`.toLowerCase().includes(query.toLowerCase()));
  const current = all.find((item) => item.id === selected);
  async function save(project: OpportunitySummary, delivery: Partial<DeliveryDetails>) {
    if (pending) return false;
    setPending(true); setMessage("");
    try {
      const result = await updateDeliveryAction({ opportunityId: project.id, delivery });
      if (!result.ok) { setMessage(result.error); return false; }
      setRecords((items) => items.map((item) => item.id === project.id ? { ...item, delivery: result.delivery } : item));
      setMessage(`${project.company.name} · ${deliveryStages.find((stage) => stage.id === result.delivery.stage)?.name} saved`);
      return true;
    } catch { setMessage("The project could not be saved. Please try again."); return false; }
    finally { setPending(false); }
  }
  function drop(event: DragEndEvent) {
    setDragged(null);
    const project = all.find((item) => item.id === event.active.id);
    const stage = deliveryStages.find((item) => item.id === event.over?.id);
    if (project && stage && deliveryDetails(project.delivery).stage !== stage.id) void save(project, { stage: stage.id });
  }
  return <>
    <header className="page-header pipeline-page-header"><div className="page-title"><span className="eyebrow">After the win</span><h1>Live projects</h1><p>{all.filter((item) => deliveryDetails(item.delivery).stage !== "complete").length} in delivery · Keep the next milestone clear</p></div><Link className="btn btn-primary" href="/pipeline">Sales pipeline <ArrowUpRight size={16} /></Link></header>
    <section className="pipeline-toolbar" aria-label="Live project filters"><label className="search-box"><Search size={15} /><input type="search" aria-label="Search live projects" placeholder="Search projects or milestones" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label className="filter-chip">Owner<select aria-label="Live project owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><span className="muted">{visible.length} shown · Won opportunities appear here automatically</span></section>
    {message ? <p className="live-board-message" role="status">{message}</p> : null}
    {!all.length ? <section className="empty-state live-empty"><Rocket size={32} /><h2>Your next chapter starts with a win</h2><p>Mark an opportunity as Won on the sales board. It will appear here in Kickoff, with its owner, contacts and history intact.</p><Link className="btn btn-primary" href="/pipeline">Open sales pipeline</Link></section> : <DndContext sensors={sensors} onDragStart={(e) => setDragged(String(e.active.id))} onDragEnd={drop} onDragCancel={() => setDragged(null)}><div className="live-board">{deliveryStages.map((stage) => <LiveColumn key={stage.id} stage={stage}><span className="live-count">{visible.filter((item) => deliveryDetails(item.delivery).stage === stage.id).length}</span>{visible.filter((item) => deliveryDetails(item.delivery).stage === stage.id).map((project) => <LiveCard key={project.id} project={project} onOpen={() => { setMessage(""); setSelected(project.id); }} disabled={pending} />)}</LiveColumn>)}</div><DragOverlay>{dragged ? <div className="live-card live-drag">{all.find((item) => item.id === dragged)?.company.name}</div> : null}</DragOverlay></DndContext>}
    {current ? <DeliveryEditor key={current.id} project={current} pending={pending} message={message} onClose={() => { if (!pending) setSelected(null); }} onSave={async (delivery) => { if (await save(current, delivery)) setSelected(null); }} /> : null}
  </>;
}

function LiveColumn({ stage, children }: { stage: typeof deliveryStages[number]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return <section ref={setNodeRef} className="live-column" data-over={isOver} aria-label={stage.name} style={{ "--stage-colour": stage.colour } as React.CSSProperties}><header><h2>{stage.name}</h2><p>{stage.description}</p></header>{children}</section>;
}
function LiveCard({ project, onOpen, disabled }: { project: OpportunitySummary; onOpen: () => void; disabled: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: project.id, disabled });
  const delivery = deliveryDetails(project.delivery);
  return <article ref={setNodeRef} className="live-card" data-dragging={isDragging}><button className="live-card-open" onClick={onOpen}><strong>{project.company.name}</strong><span>{project.title}</span><p>{delivery.nextMilestone || "Set the next milestone"}</p><footer><small>{project.owner?.name ?? "Unassigned"}</small>{delivery.dueDate ? <time dateTime={delivery.dueDate}><CalendarDays size={12} />{delivery.dueDate}</time> : null}</footer></button><button className="live-grip" aria-label={`Drag ${project.company.name}`} {...attributes} {...listeners}><GripVertical size={15} /></button></article>;
}
function DeliveryEditor({ project, pending, message, onClose, onSave }: { project: OpportunitySummary; pending: boolean; message: string; onClose: () => void; onSave: (delivery: DeliveryDetails) => Promise<void> }) {
  const ref = useDialogFocus(onClose);
  const delivery = deliveryDetails(project.delivery);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await onSave({ stage: String(form.get("stage")) as DeliveryDetails["stage"], dueDate: String(form.get("dueDate")) || null, nextMilestone: String(form.get("nextMilestone")), notes: String(form.get("notes")) });
  }
  return <div className="dialog-backdrop"><section ref={ref} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delivery-title"><header className="dialog-header"><div><span className="eyebrow">Live project</span><h2 id="delivery-title">{project.company.name}</h2><p>{project.title}</p></div><button className="icon-button" type="button" disabled={pending} onClick={onClose} aria-label="Close project"><X size={18} /></button></header><form className="dialog-form" onSubmit={submit}><div className="form-grid"><label className="field-label">Delivery stage<select data-autofocus className="field-select" name="stage" defaultValue={delivery.stage}>{deliveryStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="field-label">Milestone due<input className="field" type="date" name="dueDate" defaultValue={delivery.dueDate ?? ""} /></label><label className="field-label form-span-2">Next milestone<input className="field" name="nextMilestone" maxLength={240} defaultValue={delivery.nextMilestone} placeholder="What does success look like next?" /></label><label className="field-label form-span-2">Delivery notes<textarea className="field-textarea" name="notes" rows={4} maxLength={10000} defaultValue={delivery.notes} placeholder="Brief, blockers, handover notes…" /></label></div><p className="muted">The sales opportunity stays Won. Contacts and activity are shared, not copied.</p>{message ? <p className="form-error" role="alert">{message}</p> : null}<footer className="dialog-actions"><Link className="btn btn-quiet" href={`/pipeline?opportunity=${project.id}`}>Open full record <ArrowUpRight size={15} /></Link><button className="btn btn-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save project</button></footer></form></section></div>;
}
