"use client";
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { mutateLiveAction } from "@/app/actions/delivery";
import { configuredDeliveryStages, type DeliveryStage } from "@/lib/domain/delivery";

export function DeliveryStageSettings({ initialStages, canEdit }: { initialStages?: DeliveryStage[]; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => configuredDeliveryStages(initialStages));
  const [stages, setStages] = useState(saved);
  const [removing, setRemoving] = useState<string | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  function change(id: string, patch: Partial<DeliveryStage>) { setStages((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }
  function move(index: number, delta: number) { const next = [...stages]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setStages(next); }
  async function save(e: FormEvent) {
    e.preventDefault(); setPending(true); setMessage("");
    try {
      const result = await mutateLiveAction({ kind: "stages", stages, replacements });
      if (!result.ok) setMessage(result.error);
      else { setSaved(stages); setReplacements({}); setMessage("Delivery stages saved. All projects keep a valid stage."); router.refresh(); }
    } catch { setMessage("Could not save stages. Please try again."); }
    finally { setPending(false); }
  }
  return <article className="surface settings-card settings-card-wide"><div><h2>Live project stages</h2><p>Shape the delivery board around how your team works. Sales stages stay unchanged.</p></div><form className="delivery-stage-form" onSubmit={save}><fieldset disabled={!canEdit || pending}>
    {stages.map((stage, index) => <div className="delivery-stage-row" key={stage.id}><label className="field-label">Name<input className="field" value={stage.name} required maxLength={60} onChange={(e) => change(stage.id, { name: e.target.value })} /></label><label className="field-label">Description<input className="field" value={stage.description} maxLength={240} onChange={(e) => change(stage.id, { description: e.target.value })} /></label><label className="field-label">Colour<input type="color" value={stage.colour} onChange={(e) => change(stage.id, { colour: e.target.value })} /></label><div className="button-row"><button className="icon-button" type="button" disabled={!index} onClick={() => move(index, -1)} aria-label={`Move ${stage.name} up`}><ArrowUp size={16} /></button><button className="icon-button" type="button" disabled={index === stages.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${stage.name} down`}><ArrowDown size={16} /></button><button className="icon-button" type="button" disabled={stages.length === 1} onClick={() => setRemoving(stage.id)} aria-label={`Remove ${stage.name}`}><Trash2 size={16} /></button></div></div>)}
    {removing ? <div className="archive-notice"><p>Remove this stage? All current and archived projects in it will move to the destination when you save. Nothing is deleted.</p><label className="field-label">Move projects to<select className="field-select" defaultValue="" onChange={(e) => {
      if (!e.target.value) return;
      const destination = e.target.value;
      setReplacements((old) => ({ ...Object.fromEntries(Object.entries(old).map(([id, to]) => [id, to === removing ? destination : to])), ...(saved.some((stage) => stage.id === removing) ? { [removing]: destination } : {}) }));
      setStages((items) => items.filter((item) => item.id !== removing)); setRemoving(null);
    }}><option value="">Choose destination…</option>{stages.filter((stage) => stage.id !== removing).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><button className="btn btn-quiet" type="button" onClick={() => setRemoving(null)}>Cancel removal</button></div> : null}
    <div className="button-row"><button className="btn btn-quiet" type="button" disabled={stages.length >= 20} onClick={() => setStages((items) => [...items, { id: `stage_${crypto.randomUUID().replaceAll("-", "")}`, name: "New stage", colour: "#6554c0", description: "" }])}><Plus size={15} />Add stage</button><button className="btn btn-primary" type="submit" disabled={!!removing}><Check size={15} />{pending ? "Saving…" : "Save stages"}</button></div></fieldset>{message ? <p role="status">{message}</p> : null}{!canEdit ? <p>Only workspace admins can edit delivery stages.</p> : null}</form></article>;
}
