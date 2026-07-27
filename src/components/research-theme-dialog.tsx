"use client";

import { Check, ChevronDown, LoaderCircle, Search, Users, X } from "lucide-react";
import { FormEvent, useState } from "react";

import { saveResearchThemeAction } from "@/app/actions/research";
import type { BoardSnapshot, ResearchThemeSummary } from "@/lib/domain/types";

export function ResearchThemeDialog({
  theme,
  offers,
  onClose,
  onSaved,
}: {
  theme: ResearchThemeSummary | null;
  offers: BoardSnapshot["offers"];
  onClose: () => void;
  onSaved: (theme: ResearchThemeSummary) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const sourceUrls = String(form.get("sourceUrls") ?? "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const result = await saveResearchThemeAction({
      themeId: theme?.id ?? null,
      title: form.get("title"),
      audience: form.get("audience"),
      problem: form.get("problem"),
      signal: form.get("signal"),
      angle: form.get("angle"),
      status: form.get("status"),
      offerId: String(form.get("offerId") ?? "") || null,
      sourceUrls,
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.theme);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-card dialog-card-wide theme-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-dialog-title">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">Market research</span>
            <h2 id="theme-dialog-title">{theme ? "Sharpen the question" : "What might be changing?"}</h2>
            <p>Capture the useful hunch first. Add evidence only when you have it.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close research theme editor"><X size={17} /></button>
        </header>
        <form className="dialog-form theme-dialog-form" onSubmit={submit}>
          <div className="theme-dialog-core">
            <label className="field-label field-primary">Research question
              <input className="field" name="title" defaultValue={theme?.title ?? ""} required minLength={2} autoFocus placeholder="A costly change or unmet need worth investigating" />
            </label>
            <label className="field-label">What problem or change are you noticing?
              <textarea className="field textarea" name="problem" rows={4} defaultValue={theme?.problem ?? ""} placeholder="Keep it concrete. What is changing, breaking or becoming newly valuable?" />
            </label>
          </div>
          <div className="theme-dialog-details">
            <details>
              <summary><span><Users size={16} /><strong>Audience and possible service</strong><small>Who feels it, and where might you help?</small></span><ChevronDown size={16} /></summary>
              <div className="form-grid">
                <label className="field-label">Audience<input className="field" name="audience" defaultValue={theme?.audience ?? ""} placeholder="Who appears to experience it?" /></label>
                <label className="field-label">Research state<select className="field-select" name="status" defaultValue={theme?.status ?? "idea"}><option value="idea">Idea</option><option value="evidence">Gathering evidence</option><option value="ready">Ready to shortlist</option></select></label>
                {offers.length > 1 ? <label className="field-label form-span-2">Possible service<select className="field-select" name="offerId" defaultValue={theme?.offerId ?? ""}><option value="">Emerging / not chosen</option>{offers.map((offer) => <option value={offer.id} key={offer.id}>{offer.name}</option>)}</select></label> : <input type="hidden" name="offerId" value={offers[0]?.id ?? ""} />}
                <label className="field-label form-span-2">Offer angle to test<textarea className="field textarea" name="angle" rows={3} defaultValue={theme?.angle ?? ""} placeholder="How might an existing or emerging service help?" /></label>
              </div>
            </details>
            <details open={Boolean(theme?.signal || theme?.sourceUrls.length)}>
              <summary><span><Search size={16} /><strong>Evidence and sources</strong><small>What would turn the hunch into a credible lead?</small></span><ChevronDown size={16} /></summary>
              <div className="form-grid">
                <label className="field-label form-span-2">Strongest signal<textarea className="field textarea" name="signal" rows={3} defaultValue={theme?.signal ?? ""} placeholder="A dated fact, repeated observation or meaningful counter-signal" /></label>
                <label className="field-label form-span-2">Source links<textarea className="field textarea" name="sourceUrls" rows={3} defaultValue={theme?.sourceUrls.join("\n") ?? ""} placeholder="One HTTPS link per line" /></label>
              </div>
            </details>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{pending ? "Saving…" : "Save theme"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
