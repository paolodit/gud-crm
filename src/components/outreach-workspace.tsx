"use client";

import { ArrowRight, Check, Globe2, ListChecks, Pencil, Phone, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import { logOutreachCallAction } from "@/app/actions/crm";
import { prepareOutreachNumberAction } from "@/app/actions/outreach";
import { OutreachContactEditor, type ContactEditField } from "@/components/outreach-contact-editor";
import { OutreachGuideEditor } from "@/components/outreach-guide-editor";
import { safeExternalUrl } from "@/lib/domain/normalise";
import { outreachOutcomes, type OutreachCandidate, type OutreachCall, type OutreachGuide } from "@/lib/domain/outreach";

type Session = { queue: string[]; index: number; attemptId: string; saved: number; skipped: number; openedFrom?: string };
type CallContext = Extract<Awaited<ReturnType<typeof prepareOutreachNumberAction>>, { ok: true }>;
type Outcome = OutreachCall["outcome"];

export function OutreachWorkspace({ candidates, phoneActivityAvailable, initialOpportunity, storageKey, guide, revision, aiEnabled, canEditGuide }: {
  candidates: OutreachCandidate[];
  phoneActivityAvailable: boolean;
  initialOpportunity?: string;
  storageKey: string;
  guide: OutreachGuide;
  revision: string;
  aiEnabled: boolean;
  canEditGuide: boolean;
}) {
  const [selection, setSelection] = useState<string[]>(() => initialOpportunity && candidates.some((item) => item.id === initialOpportunity && item.numbers.length) ? [initialOpportunity] : []);
  const [session, setSession] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [editingCompany, setEditingCompany] = useState<{ id: string; field: ContactEditField } | null>(null);
  const [editingGuide, setEditingGuide] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const byId = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates]);
  const matches = useDeferredValue(query).trim().toLocaleLowerCase();
  const selected = selection.map((id) => byId.get(id)).filter((item): item is OutreachCandidate => Boolean(item?.numbers.length));
  const shown = useMemo(() => candidates.filter((item) => [item.companyName, item.title, item.offer, item.contact?.name].some((value) => value?.toLocaleLowerCase().includes(matches))), [candidates, matches]);

  useEffect(() => {
    try {
      const value = sessionStorage.getItem(storageKey);
      if (!value) return;
      const saved: Session = JSON.parse(value);
      if ((!initialOpportunity || initialOpportunity === saved.openedFrom)
        && Array.isArray(saved.queue) && saved.queue.every((id) => typeof id === "string")
        && typeof saved.attemptId === "string" && Number.isSafeInteger(saved.index) && saved.index >= 0
        && Number.isSafeInteger(saved.saved) && Number.isSafeInteger(saved.skipped)) {
        queueMicrotask(() => setSession(saved));
      }
    } catch { /* The session can still run without browser storage. */ }
  }, [initialOpportunity, storageKey]);

  function updateSession(next: Session | null) {
    setSession(next);
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The session can still run without browser storage. */ }
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function toggle(item: OutreachCandidate) {
    setSelection((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : [...current.filter((id) => byId.get(id)?.companyId !== item.companyId), item.id]);
  }

  function advance(active: Session, didSave: boolean) {
    setNotice(didSave ? "Call saved to the CRM." : "Company skipped.");
    updateSession({
      ...active,
      index: active.index + 1,
      attemptId: crypto.randomUUID(),
      saved: active.saved + Number(didSave),
      skipped: active.skipped + Number(!didSave),
    });
  }

  const currentId = session?.queue[session.index];
  const current = currentId ? byId.get(currentId) : undefined;
  return <div className="outreach-page">
    <header className="outreach-heading">
      <h1 ref={titleRef} tabIndex={-1}>{current ? current.companyName : currentId ? "Company unavailable" : session ? "Session complete" : "Outreach"}</h1>
      {current && session ? <p>Company {session.index + 1} of {session.queue.length} · {current.stage}{current.offer ? ` · ${current.offer}` : ""}</p>
        : !session && <p>Choose the companies you want to call. They’ll appear in the order you pick them.</p>}
      {canEditGuide && !current && !editingGuide && <button className="btn btn-quiet btn-compact" type="button" onClick={() => setEditingGuide(true)}><Pencil size={14} aria-hidden="true" />Edit call guide</button>}
      <div className="outreach-notice" role="status">{notice}</div>
    </header>

    {editingGuide && <OutreachGuideEditor guide={guide} revision={revision} aiEnabled={aiEnabled} onClose={() => setEditingGuide(false)} />}

    {!phoneActivityAvailable && <p className="form-error">Add an active phone activity type in <Link href="/settings?tab=sales">Sales settings</Link> to log calls.</p>}

    {session ? currentId
      ? current?.numbers.length && phoneActivityAvailable
        ? <CallCard key={session.attemptId} candidate={current} attemptId={session.attemptId} guide={guide} aiEnabled={aiEnabled}
          onEditGuide={canEditGuide && !editingGuide ? () => setEditingGuide(true) : undefined} onAdvance={(saved) => advance(session, saved)} />
        : <section className="surface outreach-panel"><p>This opportunity or number is no longer available for calling.</p><button type="button" className="btn btn-primary" onClick={() => advance(session, false)}>Skip to next company <ArrowRight size={16} /></button></section>
      : <section className="surface outreach-panel">
        <p>{session.saved} {session.saved === 1 ? "call" : "calls"} logged{session.skipped > 0 ? ` · ${session.skipped} skipped` : ""}</p>
        <button type="button" className="btn btn-primary" onClick={() => { setSelection([]); setNotice(""); updateSession(null); }}>Choose companies for a new session</button>
      </section>
      : <div className="outreach-pick-grid">
        <section className="surface outreach-panel">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Find a company or opportunity" placeholder="Find a company or opportunity" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <ul className="outreach-company-list">
            {shown.map((item) => {
              const website = safeExternalUrl(item.websiteUrl);
              const isEditing = editingCompany?.id === item.id;
              return <li key={item.id}>
                <div className="outreach-company-row">
                  <label><input type="checkbox" checked={selection.includes(item.id)} disabled={!item.numbers.length} onChange={() => toggle(item)} />
                    <span><strong>{item.companyName}</strong><small>{item.title} · {item.stage}{item.offer ? ` · ${item.offer}` : ""}</small></span>
                  </label>
                  <div className="outreach-company-actions">
                    {website
                      ? <a className="btn btn-quiet btn-compact" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" />Website</a>
                      : <button className="btn btn-quiet btn-compact" type="button" onClick={() => setEditingCompany({ id: item.id, field: "website" })}><Globe2 size={14} aria-hidden="true" />Add website</button>}
                    <button type="button" className="btn btn-quiet btn-compact" aria-expanded={isEditing}
                      onClick={() => setEditingCompany(isEditing ? null : { id: item.id, field: "phone" })}>{item.numbers.length ? "Edit contact details" : "Review phone details"}</button>
                  </div>
                </div>
                {isEditing && <OutreachContactEditor key={editingCompany.field} candidate={item} focus={editingCompany.field} aiEnabled={aiEnabled} onClose={() => setEditingCompany(null)} />}
              </li>;
            })}
          </ul>
          {!shown.length && <p>{matches ? "No matching companies." : "Start outreach on a target or use an active pipeline opportunity to add companies here."}</p>}
        </section>
        <aside className="surface outreach-panel outreach-selection">
          <h2><ListChecks size={19} aria-hidden="true" />Your call list</h2>
          {selected.length > 0 ? <ol>{selected.map((item) => <li key={item.id}>{item.companyName}</li>)}</ol> : <p>Pick a company to add it to the list.</p>}
          <button type="button" className="btn btn-primary" disabled={!selected.length || !phoneActivityAvailable} onClick={() => {
            setNotice("");
            updateSession({ queue: selected.map((item) => item.id), index: 0, attemptId: crypto.randomUUID(), saved: 0, skipped: 0, openedFrom: initialOpportunity });
          }}>Start session <ArrowRight size={16} aria-hidden="true" /></button>
        </aside>
      </div>}
  </div>;
}

function CallCard({ candidate, attemptId, onAdvance, guide, aiEnabled, onEditGuide }: {
  candidate: OutreachCandidate;
  attemptId: string;
  onAdvance: (saved: boolean) => void;
  guide: OutreachGuide;
  aiEnabled: boolean;
  onEditGuide?: () => void;
}) {
  const router = useRouter();
  const [numberId, setNumberId] = useState(candidate.numbers[0].contactId);
  const [screenedNumber, setScreenedNumber] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ key: string; data: CallContext } | null>(null);
  const [script, setScript] = useState<"gatekeeper" | "decisionMaker" | "voicemail">(candidate.numbers[0].contactId === "switchboard" ? "gatekeeper" : "decisionMaker");
  const [contactEdit, setContactEdit] = useState<ContactEditField | null>(null);
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const notes = useRef("");
  const restoreNotes = useCallback((field: HTMLTextAreaElement | null) => {
    if (field) field.value = notes.current;
  }, []);
  const [objection, setObjection] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [stopScope, setStopScope] = useState<OutreachCall["stopScope"]>("contact");
  const [logging, setLogging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const outcomeRef = useRef<HTMLSelectElement>(null);
  const dialRef = useRef<HTMLAnchorElement>(null);
  const busy = useRef(false);
  const taskId = useId();
  const number = candidate.numbers.find((item) => item.contactId === numberId) ?? candidate.numbers[0];
  const numberKey = `${number.contactId}:${number.dial}`;
  const screened = screenedNumber === numberKey;
  const context = prepared?.key === numberKey ? prepared.data : null;
  const contactId = number.contactId === "switchboard" ? null : number.contactId;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const companyUrl = safeExternalUrl(candidate.linkedinUrl);
  const contactUrl = safeExternalUrl(candidate.contact?.linkedinUrl);
  const website = safeExternalUrl(candidate.websiteUrl);
  const opener = script === "gatekeeper" ? guide.opener : guide[script];
  const followUpRequired = outcome === "follow_up";
  const demoBooked = outcome === "demo_booked";
  const doNotContact = outcome === "do_not_contact";

  function selectNumber(next: string) {
    setNumberId(next);
    setScript(next === "switchboard" ? "gatekeeper" : "decisionMaker");
    setScreenedNumber(null);
    setPrepared(null);
    setError("");
  }

  async function prepare() {
    if (busy.current || !screened) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await prepareOutreachNumberAction({ opportunityId: candidate.id, contactId, number: number.dial });
      if (!result.ok) return setError(result.error);
      setPrepared({ key: numberKey, data: result });
      requestAnimationFrame(() => dialRef.current?.focus());
    } catch {
      setError("Could not check the number. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function showOutcome(value: Outcome | "" = "") {
    setOutcome(value);
    setLogging(true);
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !context || !outcome) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await logOutreachCallAction({
        attemptId, opportunityId: candidate.id, contactId, number: number.dial, screened: true,
        outcome, notes: notes.current, objection, timeZone,
        taskTitle: doNotContact || demoBooked ? "" : taskTitle,
        dueLocal: doNotContact ? "" : dueLocal,
        stopScope: doNotContact ? contactId ? stopScope : "company" : null,
      } satisfies OutreachCall);
      if (!result.ok) return setError(result.error);
      onAdvance(true);
      if (doNotContact) router.refresh();
    } catch {
      setError("Could not save the call. Your notes are still here. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="outreach-call-grid">
    <section className="surface outreach-panel">
      <h2>Call details</h2>
      {candidate.contact && <p><strong>{candidate.contact.name}</strong>{candidate.contact.title ? ` · ${candidate.contact.title}` : ""}</p>}
      <div className="company-contact-links">
        {companyUrl && <a href={companyUrl} target="_blank" rel="noopener noreferrer">Company LinkedIn</a>}
        {contactUrl && <a href={contactUrl} target="_blank" rel="noopener noreferrer">Contact LinkedIn</a>}
        {website ? <a href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" />Website</a>
          : !logging && <button type="button" onClick={() => setContactEdit("website")}><Globe2 size={14} aria-hidden="true" />Add website</button>}
        {!logging && <button type="button" onClick={() => setContactEdit("phone")}>Edit contact details</button>}
      </div>
      {contactEdit && !logging && <OutreachContactEditor key={contactEdit} candidate={candidate} focus={contactEdit} aiEnabled={aiEnabled} onClose={() => setContactEdit(null)} />}
      <label className="field-label">Number to call
        <select className="field-select" value={number.contactId} disabled={pending || logging} onChange={(event) => selectNumber(event.target.value)}>
          {candidate.numbers.map((option) => <option key={option.contactId} value={option.contactId}>{option.label} · {option.display}</option>)}
        </select>
      </label>
      {context ? <>
        <a ref={dialRef} href={`tel:${number.dial}`} className="btn btn-primary"><Phone size={16} aria-hidden="true" />Call {number.display}</a>
        {!logging && <div className="outreach-guide-options">
          <button type="button" className="btn btn-quiet" onClick={() => showOutcome()}>Log outcome</button>
          <button type="button" className="btn btn-quiet" onClick={() => showOutcome("no_answer")}>No answer</button>
        </div>}
        {context.lastActivity && <div className="outreach-last"><h3>Last interaction</h3><p>{new Date(context.lastActivity.at).toLocaleDateString("en-GB", { timeZone })}{context.lastActivity.outcome ? ` · ${context.lastActivity.outcome}` : ""}</p>{context.lastActivity.notes && <p>{context.lastActivity.notes}</p>}</div>}
      </> : <>
        <label className="outreach-check"><input type="checkbox" disabled={pending} checked={screened} onChange={(event) => setScreenedNumber(event.target.checked ? numberKey : null)} />I’ve checked this number against TPS, CTPS and our do-not-call list and can call it.</label>
        <button type="button" className="btn btn-primary" disabled={pending || !screened} onClick={() => void prepare()}>Prepare call <ArrowRight size={16} aria-hidden="true" /></button>
        {error && <p role="alert" className="form-error">{error}</p>}
      </>}
      <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => {
        if ((notes.current || objection) && !window.confirm("Skip this company and discard the unsaved call notes?")) return;
        onAdvance(false);
      }}>Skip company</button>
    </section>

    <section className="surface outreach-panel outreach-guide">
      <div className="outreach-guide-heading"><h2>What to say</h2>{onEditGuide && <button type="button" className="btn btn-quiet btn-compact" onClick={onEditGuide}><Pencil size={14} aria-hidden="true" />Edit call guide</button>}</div>
      <div className="outreach-guide-options" role="group" aria-label="Call scripts">
        {([["gatekeeper", "Gatekeeper"], ["decisionMaker", "Decision-maker"], ["voicemail", "Voicemail"]] as const).map(([id, label]) =>
          <button type="button" className="btn btn-quiet" key={id} aria-pressed={script === id} onClick={() => setScript(id)}>{label}</button>,
        )}
      </div>
      <blockquote>{opener}</blockquote>
      {script === "gatekeeper" && <p>{guide.gatekeeper}</p>}
      {guide.objections.length > 0 && <div className="outreach-objections">
        <h3>Common objections</h3>
        <ul>{guide.objections.map(({ label, reply }) => <li key={label}>
          <strong>{label}</strong><p>{reply}</p>
          {context && <button type="button" className="btn btn-quiet btn-compact" disabled={pending} onClick={() => setObjection(label)}>
            {objection === label ? <><Check size={14} aria-hidden="true" />Added to outcome</> : "Add to outcome"}
          </button>}
        </li>)}</ul>
      </div>}
    </section>

    {context && logging && <section className="surface outreach-panel outreach-result">
      <h2>Call outcome</h2>
      <form className="outreach-result-form" onSubmit={save}>
        <label className="field-label">Outcome
          <select ref={outcomeRef} className="field-select" value={outcome} required disabled={pending} onChange={(event) => setOutcome(event.target.value as Outcome | "")}>
            <option value="">Choose what happened</option>
            {Object.entries(outreachOutcomes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="field-label">Objection raised
          <select className="field-select" value={objection} disabled={pending} onChange={(event) => setObjection(event.target.value)}>
            <option value="">None recorded</option>
            {objection && !guide.objections.some(({ label }) => label === objection) && <option>{objection}</option>}
            {guide.objections.map(({ label }) => <option key={label}>{label}</option>)}
          </select>
        </label>
        <label className="field-label">Call notes<textarea ref={restoreNotes} className="field textarea" rows={3} maxLength={10_000} readOnly={pending} onInput={(event) => { notes.current = event.currentTarget.value; }} /></label>
        {doNotContact ? contactId
          ? <label className="field-label">Apply do not contact to<select className="field-select" disabled={pending} value={stopScope ?? "contact"} onChange={(event) => setStopScope(event.target.value as "contact" | "company")}><option value="contact">This contact</option><option value="company">The whole company</option></select></label>
          : <p>The company will be marked do not contact.</p>
          : <>
            {!demoBooked && <label className="field-label">{followUpRequired ? "Follow-up task" : "Follow-up task (optional)"}<input className="field" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={240} required={followUpRequired || Boolean(dueLocal)} minLength={2} disabled={pending} placeholder="e.g. Call back after the retail operations meeting" /></label>}
            {(demoBooked || followUpRequired || taskTitle) && <label className="field-label">{demoBooked ? "Agreed demo date and time" : "Follow-up date and time"}<input className="field" type="datetime-local" value={dueLocal} onChange={(event) => setDueLocal(event.target.value)} required disabled={pending} aria-describedby={taskId} /><small id={taskId}>{timeZone.replaceAll("_", " ")}{demoBooked ? " · Saved as a CRM task" : ""}</small></label>}
          </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save & next"}<ArrowRight size={16} aria-hidden="true" /></button>
      </form>
    </section>}
  </div>;
}
