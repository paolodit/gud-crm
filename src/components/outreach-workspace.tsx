"use client";

import { ArrowRight, Check, ListChecks, Phone, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { logOutreachCallAction } from "@/app/actions/crm";
import { prepareOutreachNumberAction } from "@/app/actions/outreach";
import { safeExternalUrl } from "@/lib/domain/normalise";
import { outreachOutcomes, outreachScripts, type OutreachCandidate, type OutreachCall } from "@/lib/domain/outreach";

type Session = { queue: string[]; index: number; attemptId: string; saved: number; skipped: number; openedFrom?: string };
type CallContext = Extract<Awaited<ReturnType<typeof prepareOutreachNumberAction>>, { ok: true }>;
type Outcome = OutreachCall["outcome"];

export function OutreachWorkspace({ candidates, phoneActivityAvailable, initialOpportunity, storageKey }: {
  candidates: OutreachCandidate[];
  phoneActivityAvailable: boolean;
  initialOpportunity?: string;
  storageKey: string;
}) {
  const [selection, setSelection] = useState<string[]>(() => initialOpportunity && candidates.some((item) => item.id === initialOpportunity && item.numbers.length) ? [initialOpportunity] : []);
  const [session, setSession] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const matches = query.trim().toLocaleLowerCase();
  const selected = selection.map((id) => byId.get(id)).filter((item): item is OutreachCandidate => Boolean(item?.numbers.length));
  const shown = candidates.filter((item) => [item.companyName, item.title, item.offer, item.contact?.name].some((value) => value?.toLocaleLowerCase().includes(matches)));

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
      <div className="outreach-notice" role="status">{notice}</div>
    </header>

    {!phoneActivityAvailable && <p className="form-error">Add an active phone activity type in <Link href="/settings?tab=sales">Sales settings</Link> to log calls.</p>}

    {session ? currentId
      ? current?.numbers.length && phoneActivityAvailable
        ? <CallCard key={session.attemptId} candidate={current} attemptId={session.attemptId} onAdvance={(saved) => advance(session, saved)} />
        : <section className="surface outreach-panel"><p>This opportunity or number is no longer available for calling.</p><button type="button" className="btn btn-primary" onClick={() => advance(session, false)}>Skip to next company <ArrowRight size={16} /></button></section>
      : <section className="surface outreach-panel">
        <p>{session.saved} {session.saved === 1 ? "call" : "calls"} logged{session.skipped > 0 ? ` · ${session.skipped} skipped` : ""}</p>
        <button type="button" className="btn btn-primary" onClick={() => { setSelection([]); setNotice(""); updateSession(null); }}>Choose companies for a new session</button>
      </section>
      : <div className="outreach-pick-grid">
        <section className="surface outreach-panel">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Find a company or opportunity" placeholder="Find a company or opportunity" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <ul className="outreach-company-list">
            {shown.map((item) => <li key={item.id}>
              <label><input type="checkbox" checked={selection.includes(item.id)} disabled={!item.numbers.length} onChange={() => toggle(item)} />
                <span><strong>{item.companyName}</strong><small>{item.title} · {item.stage}{item.offer ? ` · ${item.offer}` : ""}</small></span>
              </label>
              {item.numbers.length === 0 && <Link href={`/pipeline?opportunity=${item.id}`}>Review phone details</Link>}
            </li>)}
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

function CallCard({ candidate, attemptId, onAdvance }: { candidate: OutreachCandidate; attemptId: string; onAdvance: (saved: boolean) => void }) {
  const router = useRouter();
  const [numberId, setNumberId] = useState(candidate.numbers[0].contactId);
  const [screened, setScreened] = useState(false);
  const [context, setContext] = useState<CallContext | null>(null);
  const [guide, setGuide] = useState<"gatekeeper" | "decisionMaker" | "voicemail">(candidate.numbers[0].contactId === "switchboard" ? "gatekeeper" : "decisionMaker");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [notes, setNotes] = useState("");
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
  const contactId = number.contactId === "switchboard" ? null : number.contactId;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const companyUrl = safeExternalUrl(candidate.linkedinUrl);
  const contactUrl = safeExternalUrl(candidate.contact?.linkedinUrl);
  const website = safeExternalUrl(candidate.websiteUrl);
  const opener = guide === "gatekeeper" ? outreachScripts.opener : outreachScripts[guide];
  const followUpRequired = outcome === "follow_up";
  const demoBooked = outcome === "demo_booked";
  const doNotContact = outcome === "do_not_contact";

  function selectNumber(next: string) {
    setNumberId(next);
    setGuide(next === "switchboard" ? "gatekeeper" : "decisionMaker");
    setScreened(false);
    setContext(null);
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
      setContext(result);
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
        outcome, notes, objection, timeZone,
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
        {website && <a href={website} target="_blank" rel="noopener noreferrer">Website</a>}
      </div>
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
        <label className="outreach-check"><input type="checkbox" disabled={pending} checked={screened} onChange={(event) => setScreened(event.target.checked)} />I’ve checked this number against TPS, CTPS and our do-not-call list and can call it.</label>
        <button type="button" className="btn btn-primary" disabled={pending || !screened} onClick={() => void prepare()}>Prepare call <ArrowRight size={16} aria-hidden="true" /></button>
        {error && <p role="alert" className="form-error">{error}</p>}
      </>}
      <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => {
        if ((notes || objection) && !window.confirm("Skip this company and discard the unsaved call notes?")) return;
        onAdvance(false);
      }}>Skip company</button>
    </section>

    <section className="surface outreach-panel outreach-guide">
      <h2>What to say</h2>
      <div className="outreach-guide-options" role="group" aria-label="Call scripts">
        {([["gatekeeper", "Gatekeeper"], ["decisionMaker", "Decision-maker"], ["voicemail", "Voicemail"]] as const).map(([id, label]) =>
          <button type="button" className="btn btn-quiet" key={id} aria-pressed={guide === id} onClick={() => setGuide(id)}>{label}</button>,
        )}
      </div>
      <blockquote>{opener}</blockquote>
      {guide === "gatekeeper" && <p>{outreachScripts.gatekeeper}</p>}
      <div className="outreach-objections">
        <h3>Common objections</h3>
        {outreachScripts.objections.map(({ label, reply }) => <details key={label}><summary>{label}</summary><p>{reply}</p>
          {context && <button type="button" className="btn btn-quiet btn-compact" disabled={pending} onClick={() => setObjection(label)}>
            {objection === label ? <><Check size={14} aria-hidden="true" />Added to outcome</> : "Add to outcome"}
          </button>}
        </details>)}
      </div>
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
            {outreachScripts.objections.map(({ label }) => <option key={label}>{label}</option>)}
          </select>
        </label>
        <label className="field-label">Call notes<textarea className="field textarea" rows={3} value={notes} maxLength={10_000} disabled={pending} onChange={(event) => setNotes(event.target.value)} /></label>
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
