"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import { createOpportunityAction } from "@/app/actions/crm";
import { applySpokenDraft, VoiceFillButton } from "@/components/voice-fill";
import { activeOffers, defaultOffer } from "@/lib/domain/offers";
import type { BoardSnapshot, OpportunitySummary, Priority, Temperature } from "@/lib/domain/types";
import { getEdition } from "@/lib/editions";

export function CreateOpportunityDialog({
  snapshot,
  onClose,
  onCreated,
}: {
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCreated: (opportunity: OpportunitySummary) => void;
}) {
  const firstOpenStage = snapshot.stages.find((stage) => stage.terminalType === "open") ?? snapshot.stages[0];
  const availableOffers = activeOffers(snapshot.offers);
  const initialOffer = defaultOffer(snapshot.offers);
  const edition = getEdition(snapshot.edition);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const nextActionTitle = value("nextActionTitle");
    const nextActionAt = nextActionTitle && value("nextActionAt") ? value("nextActionAt") : "";
    const ownerId = value("ownerId") || null;
    const fitScoreValue = value("fitScore");
    const expectedValue = value("expectedValue");
    const probability = value("probability");
    const expectedCloseDate = value("expectedCloseDate");
    const input = {
      companyName: value("companyName"),
      websiteUrl: value("websiteUrl"),
      companyLinkedinUrl: value("companyLinkedinUrl"),
      sector: value("sector"),
      fitScore: fitScoreValue ? Number(fitScoreValue) : null,
      title: value("title"),
      offerId: value("offerId") || initialOffer?.id || null,
      stageId: value("stageId"),
      ownerId,
      priority: value("priority") as Priority,
      temperature: value("temperature") as Temperature,
      expectedValue: expectedValue ? Number(expectedValue) : null,
      probability: probability ? Number(probability) : null,
      expectedCloseDate: expectedCloseDate ? new Date(`${expectedCloseDate}T12:00:00`) : null,
      outreachAngle: value("outreachAngle"),
      contactName: value("contactName"),
      contactTitle: value("contactTitle"),
      contactEmail: value("contactEmail"),
      contactPhone: value("contactPhone"),
      contactLinkedinUrl: value("contactLinkedinUrl"),
      nextActionTitle,
      nextActionAt: nextActionAt ? new Date(nextActionAt) : null,
    };

    const result = await createOpportunityAction(input);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const owner = snapshot.users.find((user) => user.id === ownerId) ?? null;
    const offer = availableOffers.find((item) => item.id === input.offerId) ?? initialOffer;
    const contactId = input.contactName ? crypto.randomUUID() : null;
    const created: OpportunitySummary = {
      id: result.opportunityId,
      stageId: input.stageId,
      position: Math.max(0, ...snapshot.opportunities.filter((item) => item.stageId === input.stageId).map((item) => item.position)) + 1000,
      offer,
      company: {
        id: result.companyId,
        name: input.companyName,
        sector: input.sector || null,
        websiteUrl: input.websiteUrl || null,
        linkedinUrl: input.companyLinkedinUrl || null,
        fitScore: input.fitScore,
        scaleNote: null,
        doNotContact: false,
      },
      title: input.title,
      priority: input.priority,
      temperature: input.temperature,
      expectedValue: input.expectedValue,
      probability: input.probability,
      expectedCloseDate: input.expectedCloseDate?.toISOString() ?? null,
      owner,
      outreachAngle: input.outreachAngle || null,
      lastActivityAt: null,
      nextActionAt: input.nextActionAt?.toISOString() ?? null,
      noNextActionReason: null,
      contacts: contactId
        ? [{
            id: contactId,
            name: input.contactName,
            title: input.contactTitle || null,
            email: input.contactEmail || null,
            phone: input.contactPhone || null,
            linkedinUrl: input.contactLinkedinUrl || null,
            primary: true,
            preferredChannel: null,
            doNotContact: false,
          }]
        : [],
      activities: [],
      tasks: input.nextActionTitle && input.nextActionAt
        ? [{
            id: crypto.randomUUID(),
            title: input.nextActionTitle,
            dueAt: input.nextActionAt.toISOString(),
            status: "open",
            owner,
            contactId,
          }]
        : [],
      recentChannels: [],
    };
    onCreated(created);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="dialog-card dialog-card-wide" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">New opportunity</span>
            <h2 id="create-title">Start with enough context to act</h2>
            <p>Company and opportunity are required. Everything else can grow with the relationship.</p>
          </div>
          <div className="dialog-header-actions"><VoiceFillButton kind="opportunity" onDraft={(draft) => applySpokenDraft(formRef.current, { ...draft, offerId: draft.offerName, ownerId: draft.ownerName })} /><button className="icon-button" type="button" onClick={onClose} aria-label="Close new opportunity form"><X size={18} /></button></div>
        </header>

        <form ref={formRef} className="dialog-form" onSubmit={submit}>
          <fieldset>
            <legend>{sentenceCase(edition.language.company)}</legend>
            <div className="form-grid">
              <label className="field-label">{sentenceCase(edition.language.company)} name<input name="companyName" aria-label="Company name" required minLength={2} autoFocus placeholder={edition.key === "service" ? "Bright Harbour Studio" : "Northstar Operations"} /></label>
              <label className="field-label">Sector<input name="sector" placeholder="Software, consultancy, hospitality…" /></label>
              <label className="field-label">Website<input name="websiteUrl" type="url" placeholder="https://example.com" /></label>
              <label className="field-label">Company LinkedIn<input name="companyLinkedinUrl" type="url" placeholder="https://linkedin.com/company/…" /></label>
              <label className="field-label">Fit score<select name="fitScore" defaultValue=""><option value="">Not scored</option>{[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Opportunity</legend>
            <div className="form-grid">
              <label className="field-label form-span-2">Opportunity title<input name="title" required minLength={2} placeholder="Team workflow rollout" /></label>
              {availableOffers.length > 1 ? <label className="field-label form-span-2">What are you pitching?<select name="offerId" defaultValue={initialOffer?.id ?? ""} required>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}
              <label className="field-label">Stage<select name="stageId" defaultValue={firstOpenStage?.id}>{snapshot.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
              <label className="field-label">Owner<select name="ownerId" defaultValue={snapshot.users[0]?.id ?? ""}><option value="">Unassigned</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
              <label className="field-label">Priority<select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label className="field-label">Temperature<select name="temperature" defaultValue="cold"><option value="cold">Cold</option><option value="warm">Warm</option><option value="hot">Hot</option><option value="at_risk">At risk</option><option value="unresponsive">Unresponsive</option></select></label>
              <label className="field-label form-span-2">Outreach angle<textarea name="outreachAngle" rows={3} placeholder="Why this account, why now, and the most credible opening…" /></label>
            </div>
            <details className="commercial-details">
              <summary>Commercial outlook <span>Optional</span></summary>
              <div className="form-grid">
                <label className="field-label">Potential value (£)<input name="expectedValue" type="number" min="0" step="100" inputMode="decimal" placeholder="12000" /></label>
                <label className="field-label">Probability<select name="probability" defaultValue=""><option value="">Not estimated</option>{[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => <option value={value} key={value}>{value}%</option>)}</select></label>
                <label className="field-label">Expected close<input name="expectedCloseDate" type="date" /></label>
              </div>
            </details>
          </fieldset>

          <fieldset>
            <legend>First contact and next action</legend>
            <div className="form-grid">
              <label className="field-label">Contact name<input name="contactName" placeholder="Optional" /></label>
              <label className="field-label">Contact role<input name="contactTitle" placeholder="Head of Operations" /></label>
              <label className="field-label">Contact email<input name="contactEmail" type="email" placeholder="name@example.com" /></label>
              <label className="field-label">Contact phone<input name="contactPhone" type="tel" placeholder="+44 20 7946 0000" /></label>
              <label className="field-label form-span-2">Contact LinkedIn<input name="contactLinkedinUrl" type="url" placeholder="https://linkedin.com/in/…" /></label>
              <label className="field-label">Next action<input name="nextActionTitle" placeholder="Send a concise introduction" /></label>
              <label className="field-label">Due<input name="nextActionAt" type="datetime-local" defaultValue={defaultDue(snapshot.generatedAt)} /></label>
            </div>
          </fieldset>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <footer className="dialog-actions">
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
              {pending ? "Creating…" : "Create opportunity"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function defaultDue(now: string) {
  const date = new Date(now);
  date.setDate(date.getDate() + 3);
  date.setHours(10, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
