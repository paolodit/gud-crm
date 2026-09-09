"use client";
import { startTransition, useRef, useState, type FormEvent } from "react";
import { saveOpportunityFieldAction } from "@/app/actions/crm";
import type { BoardSnapshot, OpportunitySummary } from "@/lib/domain/types";

type Field = "title" | "outreachAngle" | "offerId" | "ownerId" | "priority" | "temperature" | "fitScore" | "scaleNote" | "expectedValue" | "probability" | "expectedCloseDate";
type Spec = { field: Field; label: string; value: string | number | null; display?: string; type?: "text" | "textarea" | "number" | "date"; options?: { value: string; label: string }[]; min?: number; max?: number; maxLength?: number };

export function OpportunityInlineDetails({ opportunity: item, snapshot, onUpdate, onEditingEnd }: { opportunity: OpportunitySummary; snapshot: BoardSnapshot; onUpdate: (item: OpportunitySummary) => void; onEditingEnd?: () => void }) {
  const [active, setActive] = useState<Field | null>(null);
  const [status, setStatus] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const nextField = useRef<Field | null>(null);
  function finishEditing() { const next = nextField.current; setActive(next); nextField.current = null; if (!next) onEditingEnd?.(); }
  const specs: Spec[] = [
    { field: "title", label: "Opportunity title", value: item.title, maxLength: 220 },
    { field: "outreachAngle", label: "Outreach angle", value: item.outreachAngle, type: "textarea", maxLength: 10000 },
    { field: "offerId", label: "Offer", value: item.offer?.id ?? null, display: item.offer?.name, options: snapshot.offers.filter((offer) => offer.active || offer.id === item.offer?.id).map((offer) => ({ value: offer.id, label: offer.name })) },
    { field: "ownerId", label: "Owner", value: item.owner?.id ?? null, display: item.owner?.name ?? "Unassigned", options: [{ value: "", label: "Unassigned" }, ...snapshot.users.filter((user) => user.active !== false).map((user) => ({ value: user.id, label: user.name }))] },
    { field: "priority", label: "Priority", value: item.priority, options: ["low", "medium", "high", "critical"].map((value) => ({ value, label: value })) },
    { field: "temperature", label: "Temperature", value: item.temperature, display: item.temperature.replaceAll("_", " "), options: ["cold", "warm", "hot", "at_risk", "unresponsive"].map((value) => ({ value, label: value.replaceAll("_", " ") })) },
    { field: "fitScore", label: "Company fit", value: item.company.fitScore, display: item.company.fitScore ? item.company.fitScore + "/5" : "Not scored", options: [{ value: "", label: "Not scored" }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: value + "/5" }))] },
    { field: "scaleNote", label: "Qualification note", value: item.company.scaleNote, type: "textarea", maxLength: 2000 },
    { field: "expectedValue", label: "Potential value (£)", value: item.expectedValue ?? null, display: item.expectedValue != null ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(item.expectedValue) : "Not estimated", type: "number", min: 0, max: 999999999 },
    { field: "probability", label: "Probability (%)", value: item.probability ?? null, display: item.probability != null ? item.probability + "%" : "Not estimated", type: "number", min: 0, max: 100 },
    { field: "expectedCloseDate", label: "Expected close", value: item.expectedCloseDate?.slice(0, 10) ?? null, display: item.expectedCloseDate ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(item.expectedCloseDate)).replace("Sept", "Sep") : "Click to add", type: "date" },
  ];
  async function save(spec: Spec, raw: string) {
    const value = ["expectedValue", "probability", "fitScore"].includes(spec.field) ? raw === "" ? null : Number(raw)
      : ["offerId", "ownerId", "expectedCloseDate"].includes(spec.field) ? raw || null : raw.trim();
    const result = await saveOpportunityFieldAction({ opportunityId: item.id, field: spec.field, value });
    if (!result.ok) { nextField.current = null; return result.error; }
    const next = { ...item };
    if (spec.field === "offerId") next.offer = snapshot.offers.find((offer) => offer.id === value) ?? null;
    else if (spec.field === "ownerId") next.owner = snapshot.users.find((user) => user.id === value) ?? null;
    else if (spec.field === "fitScore" || spec.field === "scaleNote") next.company = { ...item.company, [spec.field]: value };
    else Object.assign(next, { [spec.field]: value });
    onUpdate(next); finishEditing(); setStatus(spec.label + " saved."); return null;
  }
  return <div ref={container} className="inline-opportunity-details"><span className="eyebrow">The opportunity</span><div className="inline-detail-grid">{specs.map((spec) => <InlineField key={spec.field} spec={spec} editing={active === spec.field} disabled={false} onEdit={() => { setStatus(""); if (active) { nextField.current = spec.field; container.current?.querySelector<HTMLFormElement>("form")?.requestSubmit(); } else setActive(spec.field); }} onCancel={finishEditing} onSave={(value) => save(spec, value)} />)}</div>{status ? <p className="inline-save-status" role="status">{status}</p> : null}</div>;
}

function InlineField({ spec, editing, disabled, onEdit, onCancel, onSave }: { spec: Spec; editing: boolean; disabled: boolean; onEdit: () => void; onCancel: () => void; onSave: (value: string) => Promise<string | null> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const cancelled = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving.current || cancelled.current) return;
    const form = e.currentTarget;
    const field = form.elements.namedItem("value") as HTMLInputElement;
    if (!field.checkValidity()) { setError(field.validationMessage); return; }
    const raw = field.value;
    if (raw === String(spec.value ?? "")) { onCancel(); return; }
    saving.current = true; setPending(true); setError(null);
    startTransition(async () => {
      try { setError(await onSave(raw)); }
      catch { setError("Could not save. Your edit is still here; leave the field to retry, or press Escape to cancel."); }
      finally { saving.current = false; setPending(false); }
    });
  }
  const wide = ["title", "outreachAngle", "scaleNote"].includes(spec.field);
  if (!editing) return <button className="inline-detail-display" data-wide={wide} data-field={spec.field} disabled={disabled} type="button" onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); cancelled.current = false; setError(null); onEdit(); } }} onClick={(e) => { if (e.detail === 0) { cancelled.current = false; setError(null); onEdit(); } }} aria-label={"Edit " + spec.label}><small>{spec.label}</small><strong>{spec.display ?? (spec.value === null || spec.value === "" ? "Click to add" : String(spec.value))}</strong></button>;
  return <form className="inline-detail-form" data-wide={wide} data-field={spec.field} aria-busy={pending} data-unsaved="true" noValidate onSubmit={submit} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.requestSubmit(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (!pending) { cancelled.current = true; onCancel(); } } }}><label className="field-label">{spec.label}
    {spec.options ? <select aria-label={spec.label} autoFocus name="value" className="field-select" defaultValue={spec.value ?? ""} disabled={pending}>{!spec.options.some((option) => option.value === "") ? <option value="" disabled>Choose…</option> : null}{spec.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : spec.type === "textarea" ? <textarea autoFocus className="field-textarea" name="value" rows={3} defaultValue={spec.value ?? ""} maxLength={spec.maxLength} disabled={pending} />
      : <input autoFocus className="field" name="value" type={spec.type ?? "text"} defaultValue={spec.value ?? ""} min={spec.min} max={spec.max} maxLength={spec.maxLength} minLength={spec.field === "title" ? 2 : undefined} required={spec.field === "title"} step={spec.field === "expectedValue" ? "0.01" : "1"} disabled={pending} />}
    </label>{["fitScore", "scaleNote"].includes(spec.field) ? <small>Shared across this company’s opportunities.</small> : null}{error ? <p role="alert" className="form-error">{error}</p> : null}<small role="status">{pending ? "Saving…" : "Saves when you leave · Esc to cancel"}</small></form>;
}
