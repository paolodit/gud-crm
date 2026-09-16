"use client";

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, ArchiveRestore, ArrowUpRight, CalendarDays, Check, Maximize2, Minimize2, Mic, Settings2, GripVertical, LoaderCircle, Plus, Search, X } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { mutateLiveAction, updateDeliveryAction, reorderLiveProjectAction } from "@/app/actions/delivery";
import { moveLiveProject } from "@/lib/domain/live-order";
import { ProjectTaskList } from "./project-task-list";
import { configuredDeliveryStages, deliveryDetails, liveProjectRecords, type DeliveryStage, type LiveProject } from "@/lib/domain/delivery";
import type { BoardSnapshot } from "@/lib/domain/types";
import { useDialogFocus } from "./use-dialog-focus";
import { useExitTransition } from "./use-exit-transition";
import { VoiceFillButton } from "./voice-fill";
import { mergeDeliveryDraft } from "@/lib/domain/delivery-voice";
import { WorkspaceVoiceButton, useWorkspaceVoice } from "./workspace-voice";
import { BoardHeaderArt } from "./board-header-art";
import { CardDensityToggle } from "./card-density-toggle";
import { useCardDensity } from "./use-card-density";
import { useBoardPan } from "./use-board-pan";

export function LiveBoard({ snapshot, voiceAiConfigured = false }: { snapshot: BoardSnapshot; voiceAiConfigured?: boolean }) {
  const dragContextId = useId();
  const boardPan = useBoardPan();
  const stages = configuredDeliveryStages(snapshot.deliveryStages);
  const [records, setRecords] = useState(() => liveProjectRecords(snapshot));
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [archived, setArchived] = useState(false);
  const [compact, setCompact] = useCardDensity("live");
  const [lastUpdated, setLastUpdated] = useState(snapshot.generatedAt);
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<LiveProject | null>(() => liveProjectRecords(snapshot).find((project) => project.id === searchParams.get("project") && !project.delivery.archivedAt) ?? null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }));
  useEffect(() => { queueMicrotask(() => { setRecords(liveProjectRecords(snapshot)); setLastUpdated(snapshot.generatedAt); }); }, [snapshot]);
  useEffect(() => {
    const navigate = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      if (typeof href !== "string") return;
      const id = new URL(href, window.location.origin).searchParams.get("project");
      const project = records.find(item => item.id === id && !item.delivery.archivedAt);
      if (project) { setCreating(false); setSelected(project); }
      else setSelected(null);
    };
    const saved = () => setSelected(null);
    window.addEventListener("gud:conversation-navigation", navigate);
    window.addEventListener("gud:conversation-saved", saved);
    return () => { window.removeEventListener("gud:conversation-navigation", navigate); window.removeEventListener("gud:conversation-saved", saved); };
  }, [records]);
  const projectCount = records.filter((item) => !item.delivery.archivedAt).length;
  const visible = records.filter((item) => Boolean(item.delivery.archivedAt) === archived && (snapshot.soloMode || owner === "all" || item.ownerId === owner) && `${item.companyName} ${item.title} ${item.delivery.nextMilestone}`.toLowerCase().includes(query.toLowerCase()));
  async function save(project: LiveProject, create = false) {
    if (pending) return false;
    setPending(true); setMessage("");
    try {
      const deliveryPatch = { ...project.delivery };
      delete deliveryPatch.position;
      const result = project.source === "direct"
        ? await mutateLiveAction({ kind: "project", project, create })
        : await updateDeliveryAction({ opportunityId: project.id, delivery: deliveryPatch });
      if (!result.ok) { setMessage(result.error); return false; }
      setRecords((items) => create ? [...items, project] : items.map((item) => item.id === project.id ? project : item));
      setLastUpdated(new Date().toISOString());
      setMessage(`${project.title} saved`);
      return true;
    } catch { setMessage("The project could not be saved. Please try again."); return false; }
    finally { setPending(false); }
  }
  async function drop(event: DragEndEvent) {
    setDragged(null);
    if (pending || !event.over || event.active.id === event.over.id) return;
    const project = visible.find((item) => item.id === event.active.id);
    const overProject = visible.find((item) => item.id === event.over?.id);
    const stage = stages.find((item) => item.id === (overProject?.delivery.stage ?? event.over?.id));
    if (!project || !stage) return;
    const stageRecords = records.filter((item) => item.delivery.stage === stage.id && !item.delivery.archivedAt).sort((a, b) => (a.delivery.position ?? Number.MAX_SAFE_INTEGER) - (b.delivery.position ?? Number.MAX_SAFE_INTEGER));
    const placement = overProject && project.delivery.stage === stage.id && stageRecords.findIndex((item) => item.id === project.id) < stageRecords.findIndex((item) => item.id === overProject.id) ? "after" as const : "before" as const;
    const move = { projectId: project.id, toStageId: stage.id, overProjectId: overProject?.id ?? null, placement };
    const previous = records;
    setPending(true); setMessage(""); setRecords(moveLiveProject(records, move));
    try {
      const result = await reorderLiveProjectAction(move);
      if (!result.ok) { setRecords(previous); setMessage(result.error); return; }
      setRecords((items) => items.map((item) => ({ ...item, delivery: result.projects.find((saved) => saved.id === item.id)?.delivery ?? item.delivery })));
      setLastUpdated(new Date().toISOString()); setMessage("Project order saved");
    } catch { setRecords(previous); setMessage("Could not save project order. Please try again."); }
    finally { setPending(false); }
  }
  function add() {
    setCreating(true); setMessage("");
    setSelected({ id: crypto.randomUUID(), source: "direct", companyName: "", title: "", ownerId: null, offerId: null, delivery: { ...deliveryDetails({}), stage: stages[0].id } });
  }
  return <>
    <header className="page-header pipeline-page-header"><BoardHeaderArt kind="delivery" /><div className="page-title"><h1>Live projects</h1><p>{projectCount} {projectCount === 1 ? "project" : "projects"} · Last updated: <time dateTime={lastUpdated} title="When this board was last refreshed or saved">{format(new Date(lastUpdated), "d MMM, HH:mm")}</time></p></div><div className="header-actions"><button className="btn btn-primary" aria-label="Add project" onClick={add}><Plus size={16} /><span className="mobile-hide">Add project</span></button></div></header>
    <section className="pipeline-toolbar" aria-label="Live project filters"><label className="search-box"><Search size={15} /><input type="search" aria-label="Search live projects" placeholder="Search projects or milestones" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="filter-row"><label className="filter-chip owner-control" hidden={snapshot.soloMode}>Owner<select aria-label="Live project owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button className="filter-chip" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{archived ? "Show current projects" : "Archive"}</button><Link className="icon-button" aria-label="Edit stages" title="Edit stages" href="/settings?tab=delivery"><Settings2 size={17} /></Link><span className="filter-chip">{visible.length} shown</span><CardDensityToggle label="Live project card density" compact={compact} onChange={setCompact} /></div></section>
    {message ? <p className="live-board-message" role="status">{message}</p> : null}
    {!visible.length ? <p className="live-board-message">{archived ? "No archived projects match. Archived projects can be restored here." : "No projects match. Add an existing project directly, or mark a sales opportunity Won."}</p> : null}
    <DndContext id={dragContextId} sensors={sensors} onDragStart={(e) => setDragged(String(e.active.id))} onDragEnd={drop} onDragCancel={() => setDragged(null)}><div className="live-board-viewport" data-density={compact ? "compact" : "comfortable"} aria-label="Live projects. Drag empty space sideways or use the horizontal scrollbar to see later stages." {...boardPan}><div className="live-board">{stages.map((stage) => {
      const projects = visible.filter((item) => item.delivery.stage === stage.id).sort((a, b) => (a.delivery.position ?? Number.MAX_SAFE_INTEGER) - (b.delivery.position ?? Number.MAX_SAFE_INTEGER));
      return <LiveColumn key={stage.id} stage={stage} count={projects.length} expanded={expanded.includes(stage.id)} onExpand={() => setExpanded((ids) => ids.includes(stage.id) ? ids.filter((id) => id !== stage.id) : [...ids, stage.id])}><SortableContext items={projects.map((project) => project.id)} strategy={expanded.includes(stage.id) ? rectSortingStrategy : verticalListSortingStrategy}>{projects.map((project) => <LiveCard key={project.id} project={project} owner={snapshot.soloMode ? undefined : snapshot.users.find((user) => user.id === project.ownerId)?.name} onOpen={() => { setMessage(""); setCreating(false); setSelected(project); }} disabled={pending || archived} />)}</SortableContext></LiveColumn>;
    })}</div></div><DragOverlay>{dragged ? <div className="live-card live-drag">{records.find((item) => item.id === dragged)?.companyName}</div> : null}</DragOverlay></DndContext>
    {selected ? <DeliveryEditor key={selected.id} project={selected} snapshot={snapshot} stages={stages} creating={creating} pending={pending} message={message} voiceAiConfigured={voiceAiConfigured} onClose={() => { if (!pending) setSelected(null); }} onSave={async (project) => { if (await save(project, creating)) setSelected(null); }} /> : null}
  </>;
}

function LiveColumn({ stage, count, expanded, onExpand, children }: { stage: DeliveryStage; count: number; expanded: boolean; onExpand: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return <section ref={setNodeRef} className="live-column" data-expanded={expanded} data-over={isOver} aria-label={stage.name} style={{ "--stage-colour": stage.colour } as React.CSSProperties} onTransitionEnd={(event) => {
    if (event.target === event.currentTarget && event.propertyName === "flex-basis" && !expanded) event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }}><header onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onExpand(); }}><div className="live-column-heading"><h2>{stage.name}</h2><button className="icon-button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${stage.name}${expanded ? " to one lane" : " to three lanes"}`} onClick={onExpand}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button><span>{count}</span></div><p>{stage.description}</p></header><div className="live-column-cards">{children}</div></section>;
}
function LiveCard({ project, owner, onOpen, disabled }: { project: LiveProject; owner?: string; onOpen: () => void; disabled: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging, transform, transition } = useSortable({ id: project.id, disabled, data: { stageId: project.delivery.stage } });
  const voice = useWorkspaceVoice();
  return <article ref={setNodeRef} className="live-card" data-project-id={project.id} data-dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}><button className="live-card-open" onClick={onOpen}><strong>{project.companyName}</strong><span>{project.title}</span>{project.delivery.projectValue != null ? <span className="live-card-value">{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(project.delivery.projectValue)}</span> : null}<p>{project.delivery.nextMilestone || "Set the next milestone"}</p>{project.delivery.tasks?.length ? <small className="live-task-progress">{project.delivery.tasks.filter((task) => task.completed).length}/{project.delivery.tasks.length} tasks done</small> : null}{owner || project.delivery.dueDate ? <footer>{owner ? <small>{owner}</small> : null}{project.delivery.dueDate ? <time dateTime={project.delivery.dueDate}><CalendarDays size={12} />{project.delivery.dueDate}</time> : null}</footer> : null}</button><div className="live-card-actions"><button className="live-voice-action" type="button" aria-label={`Update ${project.companyName} project by voice or text`} title="Talk through a project update" disabled={disabled || !voice} onClick={() => voice?.open({ kind: project.source === "direct" ? "direct" : "delivery", id: project.id })}><Mic size={14} /></button><button className="live-grip" aria-label={`Drag ${project.companyName}`} {...attributes} {...listeners}><GripVertical size={15} /></button></div></article>;
}
function DeliveryEditor({ project, snapshot, stages, creating, pending, message, voiceAiConfigured, onClose, onSave }: { project: LiveProject; snapshot: BoardSnapshot; stages: DeliveryStage[]; creating: boolean; pending: boolean; message: string; voiceAiConfigured: boolean; onClose: () => void; onSave: (project: LiveProject) => Promise<void> }) {
  const { closing, close } = useExitTransition(onClose);
  const requestClose = () => { if (!pending) close(); };
  const ref = useDialogFocus(requestClose);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [delivery, setDelivery] = useState(project.delivery);
  const [value, setValue] = useState(project.delivery.projectValue?.toString() ?? "");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    const draftTask = String(form.get("projectTaskDraft") ?? "").trim();
    const tasks = [...delivery.tasks ?? []];
    if (draftTask) tasks.push({ id: crypto.randomUUID(), text: draftTask, completed: false });
    await onSave({ ...project, ...(project.source === "direct" ? { title: String(form.get("title")), companyName: String(form.get("companyName")), ownerId: String(form.get("ownerId")) || null, offerId: String(form.get("offerId")) || null } : {}), delivery: { ...project.delivery, tasks, projectValue: value.trim() === "" ? null : Number(value), stage: String(form.get("stage")), dueDate: String(form.get("dueDate")) || null, nextMilestone: String(form.get("nextMilestone")), notes: String(form.get("notes")) } });
  }
  async function archive() {
    if (!project.delivery.archivedAt && !confirmArchive) { setConfirmArchive(true); return; }
    await onSave({ ...project, delivery: { ...project.delivery, archivedAt: project.delivery.archivedAt ? null : new Date().toISOString() } });
  }
  return <div className="dialog-backdrop" data-closing={closing} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section ref={ref} className="dialog-card" data-gud-navigation-safe={!hasManualEdits && !pending && !creating} role="dialog" aria-modal="true" aria-labelledby="delivery-title"><header className="dialog-header"><div><span className="eyebrow">Live project</span><h2 id="delivery-title">{creating ? "Add a project" : project.companyName}</h2><p>{creating ? "Already working together? Start here, without a sales cycle." : project.title}</p></div><div className="dialog-header-actions">{!creating ? <WorkspaceVoiceButton iconOnly target={{ kind: project.source === "direct" ? "direct" : "delivery", id: project.id }} disabled={pending || hasManualEdits || Boolean(project.delivery.archivedAt)} beforeOpen={onClose} /> : <VoiceFillButton iconOnly kind="delivery_update" creatingProject={creating} aiConfigured={voiceAiConfigured} onDraft={(draft) => { const result = mergeDeliveryDraft(delivery, draft, stages); setDelivery(result.delivery); if (result.count && draft.deliveryValue != null) setValue(String(result.delivery.projectValue)); return result.count; }} />}<button className="icon-button" type="button" disabled={pending} onClick={requestClose} aria-label="Close project"><X size={18} /></button></div></header><form className="dialog-form" onSubmit={submit} onChange={() => setHasManualEdits(true)}>{hasManualEdits && !creating ? <p className="muted">Save or close your manual edits before starting a combined voice update.</p> : null}<div className="form-grid">
    {project.source === "direct" ? <><label className="field-label">Project name<input className="field" name="title" required maxLength={200} defaultValue={project.title} /></label><label className="field-label">Organisation / client<input className="field" name="companyName" required maxLength={200} defaultValue={project.companyName} /></label><label className="field-label owner-control" hidden={snapshot.soloMode}>Owner<select className="field-select" aria-label="Owner" name="ownerId" defaultValue={project.ownerId ?? ""}><option value="">Unassigned</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="field-label">Offer<select className="field-select" name="offerId" defaultValue={project.offerId ?? ""}><option value="">No offer</option>{snapshot.offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label></> : null}
    <label className="field-label form-span-2">Project value (£)<input className="field" name="projectValue" aria-label="Project value (£)" type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Not set" aria-describedby="project-value-hint" /><small id="project-value-hint" className="muted">Agreed delivery value. Kept separate from sales estimates and totals.</small></label>
    <label className="field-label">Delivery stage<select className="field-select" name="stage" value={delivery.stage} onChange={(e) => setDelivery({ ...delivery, stage: e.target.value })}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="field-label">Milestone due<input className="field" type="date" name="dueDate" value={delivery.dueDate ?? ""} onChange={(e) => setDelivery({ ...delivery, dueDate: e.target.value || null })} /></label><label className="field-label form-span-2">Next milestone<input className="field" name="nextMilestone" maxLength={240} value={delivery.nextMilestone} onChange={(e) => setDelivery({ ...delivery, nextMilestone: e.target.value })} placeholder="What does success look like next?" /></label><ProjectTaskList tasks={delivery.tasks ?? []} disabled={pending} onChange={(tasks) => { setDelivery((current) => ({ ...current, tasks })); setHasManualEdits(true); }} /><label className="field-label form-span-2">Delivery notes<textarea className="field-textarea" aria-label="Delivery notes" name="notes" rows={4} maxLength={10000} value={delivery.notes} onChange={(e) => setDelivery({ ...delivery, notes: e.target.value })} /></label></div><p className="muted delivery-editor-note">{project.source === "sales" ? "The sales opportunity stays Won. Contacts and activity are shared, not copied." : "Direct projects are kept separate from sales opportunities and won totals."}</p>{message ? <p className="form-error" role="alert">{message}</p> : null}{confirmArchive ? <div className="archive-notice" role="alert"><p>Archive this project? It leaves the live board, but its details and sales history stay safe. Restore it later from Archive.</p><button type="button" className="btn btn-quiet" onClick={() => setConfirmArchive(false)}>Cancel archive</button></div> : null}<footer className="dialog-actions">{!creating ? <button className="btn btn-quiet" type="button" disabled={pending} onClick={archive}>{project.delivery.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.delivery.archivedAt ? "Restore project" : confirmArchive ? "Confirm archive" : "Archive project"}</button> : null}{project.source === "sales" ? <Link className="btn btn-quiet" href={`/pipeline?opportunity=${project.id}`}>Open full record <ArrowUpRight size={15} /></Link> : null}<button className="btn btn-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save project</button></footer></form></section></div>;
}
