"use client";

import { Building2, Check, LoaderCircle, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import { saveCompanyAction } from "@/app/actions/crm";
import { applySpokenDraft, VoiceFillButton } from "@/components/voice-fill";
import type { CompanySummary, OfferSummary } from "@/lib/domain/types";

export function CompanyEditorDialog({
  company,
  offers = [],
  onClose,
  onSaved,
}: {
  company?: CompanySummary | null;
  offers?: OfferSummary[];
  onClose: () => void;
  onSaved: (company: CompanySummary, opportunityId: string | null) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const score = String(form.get("fitScore") ?? "");
    const result = await saveCompanyAction({
      companyId: company?.id ?? null,
      name: form.get("name"),
      sector: form.get("sector"),
      websiteUrl: form.get("websiteUrl"),
      linkedinUrl: form.get("linkedinUrl"),
      fitScore: score ? Number(score) : null,
      scaleNote: form.get("scaleNote"),
      researchNote: form.get("researchNote"),
      offerId: String(form.get("offerId") ?? "") || null,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(result.company, result.opportunityId);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="company-dialog-title">
        <header className="dialog-header">
          <div><span className="eyebrow">Company record</span><h2 id="company-dialog-title">{company ? `Edit ${company.name}` : "Add a company"}</h2><p>{company ? "Keep the fit and research context useful for the next person." : "Creates the company and a research card so it cannot disappear between lists."}</p></div>
          <div className="dialog-header-actions"><VoiceFillButton kind="company" onDraft={(draft) => applySpokenDraft(formRef.current, { name: draft.companyName, sector: draft.sector, websiteUrl: draft.websiteUrl, linkedinUrl: draft.companyLinkedinUrl, fitScore: draft.fitScore, scaleNote: draft.scaleNote, researchNote: draft.researchNote })} /><button className="icon-button" type="button" onClick={onClose} aria-label="Close company editor"><X size={17} /></button></div>
        </header>
        <form ref={formRef} className="dialog-form" onSubmit={submit}>
          <fieldset><legend>Company details</legend><div className="form-grid">
            {!company && offers.filter((offer) => offer.active).length > 1 ? <label className="field-label form-span-2">Likely offer<select className="field-select" name="offerId" defaultValue=""><option value="">Decide after research</option>{offers.filter((offer) => offer.active).map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}
            <label className="field-label">Company name<input className="field" name="name" defaultValue={company?.name ?? ""} required minLength={2} autoFocus /></label>
            <label className="field-label">Sector<input className="field" name="sector" defaultValue={company?.sector ?? ""} placeholder="e.g. Fashion and apparel" /></label>
            <label className="field-label">Website<input className="field" name="websiteUrl" type="url" defaultValue={company?.websiteUrl ?? ""} placeholder="https://…" /></label>
            <label className="field-label">LinkedIn company page<input className="field" name="linkedinUrl" type="url" defaultValue={company?.linkedinUrl ?? ""} placeholder="https://linkedin.com/company/…" /></label>
            <label className="field-label">Fit score<select className="field-select" name="fitScore" defaultValue={company?.fitScore ?? ""}><option value="">Not scored</option><option value="1">1 / 5</option><option value="2">2 / 5</option><option value="3">3 / 5</option><option value="4">4 / 5</option><option value="5">5 / 5</option></select></label>
            <label className="field-label">Scale / qualification note<input className="field" name="scaleNote" defaultValue={company?.scaleNote ?? ""} placeholder="e.g. 69 UK stores" /></label>
            <label className="field-label form-span-2">Research note<textarea className="field textarea" name="researchNote" rows={4} defaultValue={company?.researchNote ?? ""} placeholder="What makes this account relevant?" /></label>
          </div></fieldset>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : company ? <Check size={15} /> : <Building2 size={15} />}{pending ? "Saving…" : company ? "Save company" : "Add company"}</button></div>
        </form>
      </section>
    </div>
  );
}
