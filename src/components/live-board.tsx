"use client";

import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive, ArchiveRestore, ArrowUpRight, CalendarDays, Check, Columns3, GripVertical, LoaderCircle, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { mutateLiveAction, updateDeliveryAction } from "@/app/actions/delivery";
import { configuredDeliveryStages, deliveryDetails, liveProjectRecords, type DeliveryStage, type LiveProject } from "@/lib/domain/delivery";
import type { BoardSnapshot } from "@/lib/domain/types";
import { useDialogFocus } from "./use-dialog-focus";
import { useExitTransition } from "./use-exit-transition";

export function LiveBoard({ snapshot }: { snapshot: BoardSnapshot }) {
  const stages = configuredDeliveryStages(snapshot.deliveryStages);
  const [records, setRecords] = useState(() => liveProjectRecords(snapshot));
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<LiveProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => { queueMicrotask(() => setRecords(liveProjectRecords(snapshot))); }, [snapshot]);
  const visible = records.filter((item) => Boolean(item.delivery.archivedAt) === archived && (owner === "all" || item.ownerId === owner) && `${item.companyName} ${item.title} ${item.delivery.nextMilestone}`.toLowerCase().includes(query.toLowerCase()));
  async function save(project: LiveProject, create = false) {
    if (pending) return false;
    setPending(true); setMessage("");
    try {
      const result = project.source === "direct"
        ? await mutateLiveAction({ kind: "project", project, create })
        : await updateDeliveryAction({ opportunityId: project.id, delivery: project.delivery });
      if (!result.ok) { setMessage(result.error); return false; }
      setRecords((items) => create ? [...items, project] : items.map((item) => item.id === project.id ? project : item));
      setMessage(`${project.title} saved`);
      return true;
    } catch { setMessage("The project could not be saved. Please try again."); return false; }
    finally { setPending(false); }
  }
  function drop(event: DragEndEvent) {
    setDragged(null);
    const project = visible.find((item) => item.id === event.active.id);
    const stage = stages.find((item) => item.id === event.over?.id);
    if (project && stage && project.delivery.stage !== stage.id) void save({ ...project, delivery: { ...project.delivery, stage: stage.id } });
  }
  function add() {
    setCreating(true); setMessage("");
    setSelected({ id: crypto.randomUUID(), source: "direct", companyName: "", title: "", ownerId: null, offerId: null, delivery: { ...deliveryDetails({}), stage: stages[0].id } });
  }
  return <>
    <header className="page-header pipeline-page-header"><div className="page-title"><span className="eyebrow">Work in motion</span><h1>Live projects</h1><p>{records.filter((item) => !item.delivery.archivedAt).length} projects · Keep the next milestone clear</p></div><div className="button-row"><Link className="btn btn-quiet" href="/pipeline">Sales pipeline <ArrowUpRight size={16} /></Link><button className="btn btn-primary" onClick={add}><Plus size={16} />Add project</button></div></header>
    <section className="pipeline-toolbar" aria-label="Live project filters"><label className="search-box"><Search size={15} /><input type="search" aria-label="Search live projects" placeholder="Search projects or milestones" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label className="filter-chip">Owner<select aria-label="Live project owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button className="btn btn-quiet" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{archived ? "Show current projects" : "Archive"}</button><Link className="btn btn-quiet" href="/settings?tab=delivery">Edit stages</Link><span className="muted">{visible.length} shown</span></section>
    {message ? <p className="live-board-message" role="status">{message}</p> : null}
    {!visible.length ? <p className="live-board-message">{archived ? "No archived projects match. Archived projects can be restored here." : "No projects match. Add an existing project directly, or mark a sales opportunity Won."}</p> : null}
    <DndContext sensors={sensors} onDragStart={(e) => setDragged(String(e.active.id))} onDragEnd={drop} onDragCancel={() => setDragged(null)}><div className="live-board-viewport"><div className="live-board">{stages.map((stage) => {
      const projects = visible.filter((item) => item.delivery.stage === stage.id);
      return <LiveColumn key={stage.id} stage={stage} count={projects.length} expanded={expanded.includes(stage.id)} onExpand={() => setExpanded((ids) => ids.includes(stage.id) ? ids.filter((id) => id !== stage.id) : [...ids, stage.id])}>{projects.map((project) => <LiveCard key={project.id} project={project} owner={snapshot.users.find((user) => user.id === project.ownerId)?.name} onOpen={() => { setMessage(""); setCreating(false); setSelected(project); }} disabled={pending || archived} />)}</LiveColumn>;
    })}</div></div><DragOverlay>{dragged ? <div className="live-card live-drag">{records.find((item) => item.id === dragged)?.companyName}</div> : null}</DragOverlay></DndContext>
    {selected ? <DeliveryEditor key={selected.id} project={selected} snapshot={snapshot} stages={stages} creating={creating} pending={pending} message={message} onClose={() => { if (!pending) setSelected(null); }} onSave={async (project) => { if (await save(project, creating)) setSelected(null); }} /> : null}
  </>;
}

function LiveColumn({ stage, count, expanded, onExpand, children }: { stage: DeliveryStage; count: number; expanded: boolean; onExpand: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return <section ref={setNodeRef} className="live-column" data-expanded={expanded} data-over={isOver} aria-label={stage.name} style={{ "--stage-colour": stage.colour } as React.CSSProperties}><header><div className="live-column-heading"><h2>{stage.name}</h2><button className="icon-button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${stage.name}${expanded ? " to one lane" : " to three lanes"}`} onClick={onExpand}><Columns3 size={15} /></button><span>{count}</span></div><p>{stage.description}</p></header><div className="live-column-cards">{children}</div></section>;
}
function LiveCard({ project, owner, onOpen, disabled }: { project: LiveProject; owner?: string; onOpen: () => void; disabled: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: project.id, disabled });
  return <article ref={setNodeRef} className="live-card" data-dragging={isDragging}><button className="live-card-open" onClick={onOpen}><strong>{project.companyName}</strong><span>{project.title}</span><p>{project.delivery.nextMilestone || "Set the next milestone"}</p><footer><small>{owner ?? "Unassigned"}</small>{project.delivery.dueDate ? <time dateTime={project.delivery.dueDate}><CalendarDays size={12} />{project.delivery.dueDate}</time> : null}</footer></button><button className="live-grip" aria-label={`Drag ${project.companyName}`} {...attributes} {...listeners}><GripVertical size={15} /></button></article>;
}
function DeliveryEditor({ project, snapshot, stages, creating, pending, message, onClose, onSave }: { project: LiveProject; snapshot: BoardSnapshot; stages: DeliveryStage[]; creating: boolean; pending: boolean; message: string; onClose: () => void; onSave: (project: LiveProject) => Promise<void> }) {
  const { closing, close } = useExitTransition(onClose);
  const requestClose = () => { if (!pending) close(); };
  const ref = useDialogFocus(requestClose);
  const [confirmArchive, setConfirmArchive] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    await onSave({ ...project, ...(project.source === "direct" ? { title: String(form.get("title")), companyName: String(form.get("companyName")), ownerId: String(form.get("ownerId")) || null, offerId: String(form.get("offerId")) || null } : {}), delivery: { ...project.delivery, stage: String(form.get("stage")), dueDate: String(form.get("dueDate")) || null, nextMilestone: String(form.get("nextMilestone")), notes: String(form.get("notes")) } });
  }
  async function archive() {
    if (!project.delivery.archivedAt && !confirmArchive) { setConfirmArchive(true); return; }
    await onSave({ ...project, delivery: { ...project.delivery, archivedAt: project.delivery.archivedAt ? null : new Date().toISOString() } });
  }
  return <div className="dialog-backdrop" data-closing={closing} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section ref={ref} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delivery-title"><header className="dialog-header"><div><span className="eyebrow">Live project</span><h2 id="delivery-title">{creating ? "Add a project" : project.companyName}</h2><p>{creating ? "Already working together? Start here, without a sales cycle." : project.title}</p></div><button className="icon-button" type="button" disabled={pending} onClick={requestClose} aria-label="Close project"><X size={18} /></button></header><form className="dialog-form" onSubmit={submit}><div className="form-grid">
    {project.source === "direct" ? <><label className="field-label">Project name<input className="field" name="title" required maxLength={200} defaultValue={project.title} /></label><label className="field-label">Organisation / client<input className="field" name="companyName" required maxLength={200} defaultValue={project.companyName} /></label><label className="field-label">Owner<select className="field-select" name="ownerId" defaultValue={project.ownerId ?? ""}><option value="">Unassigned</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="field-label">Offer<select className="field-select" name="offerId" defaultValue={project.offerId ?? ""}><option value="">No offer</option>{snapshot.offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label></> : null}
    <label className="field-label">Delivery stage<select className="field-select" name="stage" defaultValue={project.delivery.stage}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="field-label">Milestone due<input className="field" type="date" name="dueDate" defaultValue={project.delivery.dueDate ?? ""} /></label><label className="field-label form-span-2">Next milestone<input className="field" name="nextMilestone" maxLength={240} defaultValue={project.delivery.nextMilestone} placeholder="What does success look like next?" /></label><label className="field-label form-span-2">Delivery notes<textarea className="field-textarea" name="notes" rows={4} maxLength={10000} defaultValue={project.delivery.notes} /></label></div><p className="muted">{project.source === "sales" ? "The sales opportunity stays Won. Contacts and activity are shared, not copied." : "Direct projects are kept separate from sales opportunities and won totals."}</p>{message ? <p className="form-error" role="alert">{message}</p> : null}{confirmArchive ? <div className="archive-notice" role="alert"><p>Archive this project? It leaves the live board, but its details and sales history stay safe. Restore it later from Archive.</p><button type="button" className="btn btn-quiet" onClick={() => setConfirmArchive(false)}>Cancel archive</button></div> : null}<footer className="dialog-actions">{!creating ? <button className="btn btn-quiet" type="button" disabled={pending} onClick={archive}>{project.delivery.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.delivery.archivedAt ? "Restore project" : confirmArchive ? "Confirm archive" : "Archive project"}</button> : null}{project.source === "sales" ? <Link className="btn btn-quiet" href={`/pipeline?opportunity=${project.id}`}>Open full record <ArrowUpRight size={15} /></Link> : null}<button className="btn btn-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save project</button></footer></form></section></div>;
}
