"use client";

import { Globe2, Search } from "lucide-react";
import { useState, type FormEvent } from "react";

import { lookUpOutreachSwitchboardAction, saveOutreachContactDetailsAction } from "@/app/actions/outreach";
import { safeExternalUrl } from "@/lib/domain/normalise";
import type { OutreachCandidate } from "@/lib/domain/outreach";

export type ContactEditField = "phone" | "website";

export function OutreachContactEditor({ candidate, focus, aiEnabled, onClose }: {
  candidate: OutreachCandidate;
  focus: ContactEditField;
  aiEnabled: boolean;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(candidate.switchboardPhone ?? "");
  const [website, setWebsite] = useState(candidate.websiteUrl ?? "");
  const [busy, setBusy] = useState<"save" | "lookup" | null>(null);
  const [error, setError] = useState("");
  const [suggested, setSuggested] = useState<{ number: string; sourceUrl: string } | null>(null);
  const savedWebsite = safeExternalUrl(candidate.websiteUrl);
  const changed = phone.trim() !== (candidate.switchboardPhone ?? "") || website.trim() !== (candidate.websiteUrl ?? "");
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${candidate.companyName} official head office phone`)}`;

  async function lookup() {
    setError("");
    setSuggested(null);
    setBusy("lookup");
    try {
      const result = await lookUpOutreachSwitchboardAction(candidate.id);
      if (!result.ok) { setError(result.error); return; }
      setSuggested({ number: result.number, sourceUrl: result.sourceUrl });
    } catch {
      setError("Could not look up the number. You can still check the website.");
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !changed) return;
    setError("");
    setBusy("save");
    try {
      const result = await saveOutreachContactDetailsAction({
        opportunityId: candidate.id,
        ...(phone.trim() !== (candidate.switchboardPhone ?? "") ? { switchboardPhone: phone } : {}),
        ...(website.trim() !== (candidate.websiteUrl ?? "") ? { websiteUrl: website } : {}),
      });
      if (!result.ok) { setError(result.error); return; }
      onClose();
    } catch {
      setError("Could not save the company details. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return <form className="outreach-contact-editor" aria-label={`Contact details for ${candidate.companyName}`} onSubmit={save}>
    <div className="outreach-contact-fields">
      <label className="field-label">Company phone
        <input className="field" type="tel" autoFocus={focus === "phone"} value={phone} maxLength={80} readOnly={busy !== null} onChange={(event) => { setPhone(event.target.value); setSuggested(null); }} />
      </label>
      <label className="field-label">Company website
        <input className="field" type="text" inputMode="url" autoFocus={focus === "website"} value={website} maxLength={2_000} readOnly={busy !== null} onChange={(event) => { setWebsite(event.target.value); setSuggested(null); }} />
      </label>
    </div>
    <div className="outreach-guide-options">
      {savedWebsite && <a className="btn btn-quiet btn-compact" href={savedWebsite} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" />Open company website</a>}
      <a className="btn btn-quiet btn-compact" href={searchUrl} target="_blank" rel="noopener noreferrer"><Search size={14} aria-hidden="true" />Search the web</a>
      {savedWebsite && aiEnabled && <button className="btn btn-quiet btn-compact" type="button" disabled={busy !== null || website.trim() !== candidate.websiteUrl} onClick={() => void lookup()}>
        {busy === "lookup" ? "Looking up…" : "Find head-office number with AI"}
      </button>}
    </div>
    {suggested && <div className="outreach-suggestion">
      <p><strong>{suggested.number}</strong> · Check the company source before using this number.</p>
      <div className="outreach-guide-options">
        <a className="btn btn-quiet btn-compact" href={suggested.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a>
        <button className="btn btn-quiet btn-compact" type="button" onClick={() => { setPhone(suggested.number); setSuggested(null); }}>Use suggested number</button>
      </div>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="outreach-guide-options">
      <button className="btn btn-primary btn-compact" type="submit" disabled={!changed || busy !== null}>{busy === "save" ? "Saving…" : "Save contact details"}</button>
      <button className="btn btn-quiet btn-compact" type="button" onClick={onClose} disabled={busy !== null}>Cancel</button>
    </div>
  </form>;
}
