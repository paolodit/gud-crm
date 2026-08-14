"use client";

import {
  Banknote,
  Building2,
  Check,
  ChevronDown,
  ContactRound,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import { parseSpokenCrmDraftAction, type SpokenCrmDraft } from "@/app/actions/ai";
import { createOpportunityAction } from "@/app/actions/crm";
import { applySpokenDraft, VoiceFillButton } from "@/components/voice-fill";
import { activeOffers, defaultOffer } from "@/lib/domain/offers";
import type { BoardSnapshot, OpportunitySummary, Priority, Temperature } from "@/lib/domain/types";
import { getEdition } from "@/lib/editions";

export function CreateOpportunityDialog({
  snapshot,
  currentUserId,
  voiceAiConfigured,
  onClose,
  onCreated,
}: {
  snapshot: BoardSnapshot;
  currentUserId: string;
  voiceAiConfigured: boolean;
  onClose: () => void;
  onCreated: (opportunity: OpportunitySummary) => void;
}) {
  const firstOpenStage = snapshot.stages.find((stage) => stage.terminalType === "open") ?? snapshot.stages[0];
  const availableOffers = activeOffers(snapshot.offers);
  const initialOffer = defaultOffer(snapshot.offers);
  const edition = getEdition(snapshot.edition);
  const ownerId = snapshot.users.some((user) => user.id === currentUserId) ? currentUserId : snapshot.users[0]?.id ?? "";
  const [pending, setPending] = useState(false);
  const [notePending, setNotePending] = useState(false);
  const [note, setNote] = useState("");
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function fillDraft(draft: SpokenCrmDraft) {
    return applySpokenDraft(formRef.current, {
      ...draft,
      offerId: draft.offerName,
      ownerId: draft.ownerName,
    });
  }

  async function structureNote() {
    if (note.trim().length < 2) return setAssistantMessage("Add a sentence or two first.");
    setNotePending(true);
    setAssistantMessage(null);
    const result = await parseSpokenCrmDraftAction({ kind: "opportunity", transcript: note });
    setNotePending(false);
    if (!result.ok) return setAssistantMessage(result.error);
    const count = fillDraft(result.draft);
    setAssistantMessage(count ? `${count} fields filled. Check them, then create the opportunity.` : "I could not find any new details to add.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const required = [
      { name: "title", label: "the opportunity" },
      { name: "companyName", label: `the ${edition.language.company.toLowerCase()}` },
    ];
    const missing = required.find((item) => value(item.name).length < 2);
    if (missing) {
      setError(`Add ${missing.label} before creating this opportunity.`);
      const field = event.currentTarget.elements.namedItem(missing.name);
      if (field instanceof HTMLInputElement) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
      return;
    }
    setPending(true);
    const nextActionTitle = value("nextActionTitle");
    const nextActionAt = nextActionTitle && value("nextActionAt") ? value("nextActionAt") : "";
    const chosenOwnerId = value("ownerId") || null;
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
      ownerId: chosenOwnerId,
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
    if (!result.ok) return setError(result.error);

    const owner = snapshot.users.find((user) => user.id === chosenOwnerId) ?? null;
    const offer = availableOffers.find((item) => item.id === input.offerId) ?? initialOffer;
    const contactId = input.contactName ? crypto.randomUUID() : null;
    onCreated({
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
      contacts: contactId ? [{
        id: contactId,
        name: input.contactName,
        title: input.contactTitle || null,
        email: input.contactEmail || null,
        phone: input.contactPhone || null,
        linkedinUrl: input.contactLinkedinUrl || null,
        primary: true,
        preferredChannel: null,
        doNotContact: false,
      }] : [],
      activities: [],
      tasks: input.nextActionTitle && input.nextActionAt ? [{
        id: crypto.randomUUID(),
        title: input.nextActionTitle,
        dueAt: input.nextActionAt.toISOString(),
        status: "open",
        owner,
        contactId,
      }] : [],
      recentChannels: [],
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="dialog-card dialog-card-wide opportunity-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">New opportunity</span>
            <h2 id="create-title">What could happen here?</h2>
            <p>Start with the opportunity. GUD can organise the supporting detail.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close new opportunity form"><X size={18} /></button>
        </header>

        <form ref={formRef} className="dialog-form opportunity-create-form" onSubmit={submit} noValidate>
          <section className="opportunity-capture">
            <div className="capture-copy">
              <span className="capture-icon"><Sparkles size={19} /></span>
              <div>
                <h3>Talk or write it naturally</h3>
                <p>Mention whatever you know. Useful clues include:</p>
                <ul>
                  <li>the opportunity and what you might offer</li>
                  <li>the organisation, sector and why now</li>
                  <li>the contact and a sensible next move</li>
                  <li>how warm it is and its likely value</li>
                </ul>
              </div>
            </div>
            <VoiceFillButton kind="opportunity" prominent aiConfigured={voiceAiConfigured} onDraft={fillDraft} />
            <div className="capture-note">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="For example: Ross wants a coffee e-shop. It feels warm. I should call him next week to understand the range and timing…" aria-label="Describe the opportunity in your own words" />
              <button className="btn btn-quiet" type="button" onClick={structureNote} disabled={notePending}>
                {notePending ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                {notePending ? "Working…" : "Fill the details"}
              </button>
            </div>
            {assistantMessage ? <p className="capture-message" role="status"><Check size={14} />{assistantMessage}</p> : null}
          </section>

          <section className="opportunity-core">
            <div className="form-grid">
              <label className="field-label form-span-2 field-primary">Opportunity <span className="required-mark">Required</span>
                <input name="title" aria-label="Opportunity title" required minLength={2} autoFocus placeholder="What could you help them achieve?" />
              </label>
              <label className="field-label">{sentenceCase(edition.language.company)} <span className="required-mark">Required</span>
                <input name="companyName" aria-label="Company name" required minLength={2} placeholder={edition.key === "service" ? "Organisation or client" : "Target organisation"} />
              </label>
              {availableOffers.length > 1 ? <label className="field-label">Offer
                <select name="offerId" defaultValue={initialOffer?.id ?? ""} required>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select>
              </label> : <input type="hidden" name="offerId" value={initialOffer?.id ?? ""} />}
              <label className="field-label form-span-2">Why this could be worth a conversation
                <textarea name="outreachAngle" rows={3} placeholder="The need, timing and most credible opening…" />
              </label>
            </div>

            <div className="signal-row">
              <fieldset className="choice-chips">
                <legend>Temperature</legend>
                {(["cold", "warm", "hot"] as Temperature[]).map((value) => <label key={value} data-temperature={value}><input type="radio" name="temperature" value={value} defaultChecked={value === "cold"} /><span>{sentenceCase(value)}</span></label>)}
              </fieldset>
              <fieldset className="choice-chips">
                <legend>Priority</legend>
                {(["low", "medium", "high"] as Priority[]).map((value) => <label key={value}><input type="radio" name="priority" value={value} defaultChecked={value === "medium"} /><span>{sentenceCase(value)}</span></label>)}
              </fieldset>
              <span className="owner-default">Owned by <strong>{snapshot.users.find((user) => user.id === ownerId)?.name ?? "you"}</strong></span>
            </div>
          </section>

          <div className="opportunity-details">
            <details>
              <summary><span><Building2 size={17} /><strong>Organisation details</strong><small>Sector, website, LinkedIn and fit</small></span><ChevronDown size={17} /></summary>
              <div className="form-grid">
                <label className="field-label">Sector<input name="sector" placeholder="Consultancy, hospitality, retail…" /></label>
                <label className="field-label">Fit score<select name="fitScore" defaultValue=""><option value="">Not scored</option>{[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></label>
                <label className="field-label">Website<input name="websiteUrl" type="text" inputMode="url" placeholder="example.com (optional)" /></label>
                <label className="field-label">Company LinkedIn<input name="companyLinkedinUrl" type="url" placeholder="https://linkedin.com/company/…" /></label>
              </div>
            </details>

            <details>
              <summary><span><ContactRound size={17} /><strong>Contact and ownership</strong><small>Add a person or hand it to a teammate</small></span><ChevronDown size={17} /></summary>
              <div className="form-grid">
                <label className="field-label">Owner<select name="ownerId" defaultValue={ownerId}><option value="">Unassigned</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
                <label className="field-label">Contact name<input name="contactName" placeholder="Optional" /></label>
                <label className="field-label">Contact role<input name="contactTitle" placeholder="Head of Operations" /></label>
                <label className="field-label">Contact email<input name="contactEmail" type="email" placeholder="name@example.com" /></label>
                <label className="field-label">Contact phone<input name="contactPhone" type="tel" placeholder="+44…" /></label>
                <label className="field-label">Contact LinkedIn<input name="contactLinkedinUrl" type="url" placeholder="https://linkedin.com/in/…" /></label>
              </div>
            </details>

            <details>
              <summary><span><Banknote size={17} /><strong>Commercial outlook and next move</strong><small>Value, timing and a first action</small></span><ChevronDown size={17} /></summary>
              <div className="form-grid">
                <label className="field-label">Potential value (£)<input name="expectedValue" type="number" min="0" step="100" inputMode="decimal" placeholder="12000" /></label>
                <label className="field-label">Probability<select name="probability" defaultValue=""><option value="">Not estimated</option>{[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => <option value={value} key={value}>{value}%</option>)}</select></label>
                <label className="field-label">Expected close<input name="expectedCloseDate" type="date" /></label>
                <label className="field-label">Stage<select name="stageId" defaultValue={firstOpenStage?.id}>{snapshot.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
                <label className="field-label">Next action<input name="nextActionTitle" placeholder="Call to understand the brief" /></label>
                <label className="field-label">Due<input name="nextActionAt" type="datetime-local" defaultValue={defaultDue(snapshot.generatedAt)} /></label>
              </div>
            </details>
          </div>

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
  return value.charAt(0).toUpperCase() + value.slice(1).replace("_", " ");
}
