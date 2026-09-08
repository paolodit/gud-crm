"use client";
import { useState, type FormEvent } from "react";
import { Check, GripVertical, Pencil, Plus, Trash2, Workflow, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { mutateLiveAction } from "@/app/actions/delivery";
import { configuredDeliveryStages, type DeliveryStage } from "@/lib/domain/delivery";

export function DeliveryStageSettings({ initialStages, canEdit }: { initialStages?: DeliveryStage[]; canEdit: boolean }) {
  const router = useRouter();
  const [stages, setStages] = useState(() => configuredDeliveryStages(initialStages));
  const [editor, setEditor] = useState<DeliveryStage | "new" | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save(next: DeliveryStage[], replacements: Record<string, string> = {}) {
    if (pending) return false;
    setPending(true); setMessage("");
    try {
      const result = await mutateLiveAction({ kind: "stages", stages: next, replacements });
      if (!result.ok) { setMessage(result.error); return false; }
      setStages(next); setMessage("Delivery stages saved. All projects keep a valid stage."); router.refresh(); return true;
    } catch { setMessage("Could not save stages. Please try again."); return false; }
    finally { setPending(false); }
  }
  function move(id: string, destination: number) {
    const index = stages.findIndex((stage) => stage.id === id);
    if (index < 0 || destination < 0 || destination >= stages.length || index === destination) return;
    const next = [...stages]; const [stage] = next.splice(index, 1); next.splice(destination, 0, stage); void save(next);
  }
  return <article className="surface settings-card settings-card-stages">
    <div className="settings-icon"><Workflow /></div><div><h2>Live project stages</h2><p>{stages.length} visible delivery stages</p></div>
    {canEdit ? <button className="btn btn-quiet settings-card-action" type="button" disabled={pending || stages.length >= 20} onClick={() => setEditor("new")}><Plus size={14} />Add stage</button> : null}
    <div className="stage-settings-list">{stages.map((stage, index) => <div key={stage.id} className="stage-settings-row" data-dragging={dragging === stage.id} draggable={canEdit && !pending && !editor} onDragStart={() => setDragging(stage.id)} onDragEnd={() => setDragging(null)} onDragOver={(e) => { if (canEdit && !pending && !editor) e.preventDefault(); }} onDrop={() => { if (dragging) move(dragging, index); setDragging(null); }}>
      <button className="stage-drag-handle" type="button" disabled={!canEdit || pending || !!editor} aria-label={`Reorder ${stage.name}. Use arrow keys or drag.`} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); move(stage.id, index + (e.key === "ArrowUp" ? -1 : 1)); } }}><GripVertical size={16} /></button>
      <button className="stage-settings-edit" type="button" disabled={!canEdit || pending} onClick={() => setEditor(stage)}><i style={{ background: stage.colour }} /><span><strong>{stage.name}</strong><small>{stage.description}</small></span>{canEdit ? <Pencil size={13} /> : null}</button>
    </div>)}</div>
    <p className="settings-hint" role="status">{message || (canEdit ? "Drag stages into delivery order, or use arrow keys on a drag handle. Sales stages stay unchanged." : "Only workspace admins can edit delivery stages.")}</p>
    {editor && canEdit ? <DeliveryStageEditor key={editor === "new" ? "new" : editor.id} stage={editor === "new" ? null : editor} stages={stages} pending={pending} onClose={() => setEditor(null)} onSave={async (stage) => { if (await save(stages.some((item) => item.id === stage.id) ? stages.map((item) => item.id === stage.id ? stage : item) : [...stages, stage])) setEditor(null); }} onRemove={async (id, destination) => { if (await save(stages.filter((item) => item.id !== id), { [id]: destination })) setEditor(null); }} /> : null}
  </article>;
}

function DeliveryStageEditor({ stage, stages, pending, onClose, onSave, onRemove }: { stage: DeliveryStage | null; stages: DeliveryStage[]; pending: boolean; onClose: () => void; onSave: (stage: DeliveryStage) => Promise<void>; onRemove: (id: string, destination: string) => Promise<void> }) {
  const [removing, setRemoving] = useState(false);
  const destinations = stages.filter((item) => item.id !== stage?.id);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    await onSave({ id: stage?.id ?? `stage_${crypto.randomUUID().replaceAll("-", "")}`, name: String(form.get("name")), description: String(form.get("description")), colour: String(form.get("colour")) });
  }
  if (removing && stage) return <form className="stage-editor" onSubmit={(e) => { e.preventDefault(); void onRemove(stage.id, String(new FormData(e.currentTarget).get("destination"))); }}><header><div><strong>Remove {stage.name}</strong><small>All current and archived projects in this stage will move to your chosen destination. Nothing is deleted.</small></div><button className="icon-button" type="button" disabled={pending} onClick={onClose} aria-label="Close stage editor"><X size={14} /></button></header><label className="field-label">Move projects to<select name="destination" required defaultValue=""><option value="" disabled>Choose destination…</option>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="team-editor-actions"><button className="btn btn-quiet" type="button" disabled={pending} onClick={() => setRemoving(false)}>Back</button><button className="btn btn-danger" disabled={pending}><Trash2 size={14} />{pending ? "Moving…" : "Move and remove"}</button></div></form>;
  return <form className="stage-editor" onSubmit={submit}><header><div><strong>{stage ? `Edit ${stage.name}` : "Add a live project stage"}</strong><small>Keep delivery stages clear and easy to understand.</small></div><button className="icon-button" type="button" disabled={pending} onClick={onClose} aria-label="Close stage editor"><X size={14} /></button></header><div className="stage-editor-fields"><label className="field-label">Name<input className="field" name="name" defaultValue={stage?.name ?? ""} required maxLength={60} /></label><label className="field-label">Description<input className="field" name="description" defaultValue={stage?.description ?? ""} maxLength={240} /></label><label className="field-label colour-field">Colour<input name="colour" type="color" defaultValue={stage?.colour ?? "#6554c0"} /></label></div><div className="team-editor-actions">{stage && destinations.length ? <button className="btn btn-danger" type="button" disabled={pending} onClick={() => setRemoving(true)}><Trash2 size={14} />Remove stage</button> : <span />}<div className="button-row"><button className="btn btn-quiet" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={pending}><Check size={14} />{pending ? "Saving…" : "Save stage"}</button></div></div></form>;
}
