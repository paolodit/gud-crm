"use client";

import { ArrowRight, Check, CheckCircle2, ChevronLeft, LoaderCircle, Mic, RotateCcw, Search, ShieldCheck, Square, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { applyWorkspaceVoiceAction, loadVoiceWorkspaceAction, prepareWorkspaceVoiceAction, recoverWorkspaceVoiceAction, undoWorkspaceVoiceAction } from "@/app/actions/voice-workspace";
import { voiceChangesSchema, voiceFieldKeys, voiceIsoToLocal, voiceLabels, voiceLocalToIso, voiceRecordHref, type VoiceChanges, type VoiceChoice, type VoiceFieldKey, type VoiceReceipt, type VoiceTarget } from "@/lib/domain/voice-workspace";
import { useDialogFocus } from "./use-dialog-focus";
import { useSpeechCapture } from "./use-speech-capture";

type Review = Extract<Awaited<ReturnType<typeof prepareWorkspaceVoiceAction>>, { ok: true }>;
type VoiceSession = { transcript: string; target: VoiceTarget | null; updatedAt: number; pending?: { planId: string; changes: VoiceChanges } };
type ReceiptNotice = Pick<VoiceReceipt, "id" | "target" | "companyName" | "expiresAt">;
type VoiceApi = { open: (target?: VoiceTarget, fromEditor?: boolean) => void };
const VoiceContext = createContext<VoiceApi | null>(null);
export const useWorkspaceVoice = () => useContext(VoiceContext);
const choiceKey = (target: VoiceTarget) => `${target.kind}:${target.id}`;
const kindName = (target: VoiceTarget) => target.kind === "sales" ? "Sales" : "Live project";

export function WorkspaceVoiceProvider({ memberKey, children }: { memberKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const storageKey = `gud-voice-draft:${memberKey}`;
  const receiptKey = `gud-voice-receipt:${memberKey}`;
  const [session, setSession] = useState<VoiceSession>({ transcript: "", target: null, updatedAt: 0 });
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [preferredTarget, setPreferredTarget] = useState<VoiceTarget | null>(null);
  const [notice, setNotice] = useState<ReceiptNotice | null>(null);
  const [noticeError, setNoticeError] = useState("");
  const [undone, setUndone] = useState(false);
  const [undoing, startUndo] = useTransition();
  const saveSession = useCallback((next: VoiceSession) => {
    setSession(next);
    try { if (next.transcript.trim() || next.pending) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory capture still works. */ }
  }, [storageKey]);
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as VoiceSession | null;
      if (draft && typeof draft.transcript === "string" && draft.transcript.length <= 12000 && Date.now() - draft.updatedAt < 24 * 3600_000) queueMicrotask(() => setSession(draft));
      const saved = JSON.parse(sessionStorage.getItem(receiptKey) ?? "null") as ReceiptNotice | null;
      if (saved?.id && Date.parse(saved.expiresAt) > Date.now()) queueMicrotask(() => setNotice(saved));
    } catch { /* Storage can be unavailable in private browsing. Capture still works. */ }
    queueMicrotask(() => setMounted(true));
  }, [storageKey, receiptKey]);
  useEffect(() => {
    if (!mounted) return;
    try { if (session.transcript.trim()) sessionStorage.setItem(storageKey, JSON.stringify(session)); else sessionStorage.removeItem(storageKey); } catch { /* Keep the in-memory draft. */ }
  }, [session, mounted, storageKey]);
  useEffect(() => {
    if (!mounted) return;
    try { if (notice) sessionStorage.setItem(receiptKey, JSON.stringify(notice)); else sessionStorage.removeItem(receiptKey); } catch { /* Undo remains available until navigation. */ }
  }, [notice, mounted, receiptKey]);
  const show = useCallback((target?: VoiceTarget, fromEditor = false) => {
    if (!fromEditor && document.querySelector(".dialog-card:not(.workspace-voice-dialog), .inline-detail-form")) {
      setNoticeError("Finish or close your current editor before starting a combined voice update."); return;
    }
    let contextual = target ?? null;
    if (!contextual) {
      const id = params.get("opportunity") ?? params.get("target") ?? params.get("project");
      if (id) contextual = { id, kind: pathname === "/live" ? "delivery" : "sales" };
    }
    setPreferredTarget(contextual); setNoticeError(""); setOpen(true);
  }, [params, pathname]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "Space" && !event.repeat) { event.preventDefault(); show(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [show]);
  function applied(receipt: VoiceReceipt) {
    setSession({ transcript: "", target: null, updatedAt: Date.now() });
    setNotice({ id: receipt.id, target: receipt.target, companyName: receipt.companyName, expiresAt: receipt.expiresAt });
    setUndone(false); setNoticeError(""); setOpen(false); router.refresh();
  }
  function undo() {
    if (!notice || undoing) return;
    startUndo(async () => {
      setNoticeError("");
      try {
        const result = await undoWorkspaceVoiceAction({ receiptId: notice.id });
        if (!result.ok) { setNoticeError(result.error); return; }
        setNotice(null); setUndone(true); router.refresh();
      } catch { setNoticeError("Could not confirm Undo. Try again; it is safe to retry."); }
    });
  }
  return <VoiceContext.Provider value={{ open: show }}>{children}
    <button className="workspace-voice-launch" type="button" onClick={() => show()} aria-label="Talk to GUD" title="Talk to GUD (Ctrl/⌘ + Shift + Space)"><Mic size={19} /><span>Talk to GUD</span>{session.transcript.trim() ? <i aria-label="Draft saved" /> : null}</button>
    {mounted && (notice || undone || noticeError) && !open ? createPortal(<aside className="workspace-voice-receipt" aria-label="Voice update receipt"><div role="status"><CheckCircle2 size={18} /><strong>{notice ? `Saved · ${notice.companyName}` : undone ? "Voice update undone" : "Talk to GUD"}</strong></div>{notice ? <><p>Your reviewed changes were applied together. Undo is available for 15 minutes.</p><div className="button-row"><Link href={voiceRecordHref(notice.target)}>Open record <ArrowRight size={13} /></Link><button type="button" className="btn btn-quiet" onClick={undo} disabled={undoing}>{undoing ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}Undo update</button></div></> : null}{noticeError ? <p role="alert" className="form-error">{noticeError}</p> : null}<button type="button" className="icon-button receipt-dismiss" aria-label="Dismiss voice receipt" onClick={() => { setNotice(null); setNoticeError(""); setUndone(false); }} disabled={undoing}><X size={15} /></button></aside>, document.body) : null}
    {mounted && open ? createPortal(<WorkspaceVoiceDialog preferredTarget={preferredTarget} session={session} onSession={saveSession} onClose={() => setOpen(false)} onApplied={applied} />, document.body) : null}
  </VoiceContext.Provider>;
}

export function WorkspaceVoiceButton({ target, label = "Talk through an update", initiallyOpen = false, disabled = false, beforeOpen }: { target: VoiceTarget; label?: string; initiallyOpen?: boolean; disabled?: boolean; beforeOpen?: () => void }) {
  const voice = useWorkspaceVoice();
  const triggered = useRef(false);
  useEffect(() => {
    if (initiallyOpen && !triggered.current && voice) { triggered.current = true; voice.open(target, true); }
  }, [initiallyOpen, target, voice]);
  return <button type="button" className="btn btn-voice" disabled={disabled || !voice} onClick={() => { beforeOpen?.(); voice?.open(target, true); }}><Mic size={16} />{label}</button>;
}

function WorkspaceVoiceDialog({ preferredTarget, session, onSession, onClose, onApplied }: { preferredTarget: VoiceTarget | null; session: VoiceSession; onSession: (session: VoiceSession) => void; onClose: () => void; onApplied: (receipt: VoiceReceipt) => void }) {
  const [choices, setChoices] = useState<VoiceChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [target, setTarget] = useState<VoiceTarget | null>(session.transcript.trim() ? session.target : preferredTarget);
  const [transcript, setTranscript] = useState(session.transcript);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [preparing, startPrepare] = useTransition();
  const [applying, startApply] = useTransition();
  const [recovering, setRecovering] = useState(Boolean(session.pending));
  const active = useRef(true);
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const close = () => { if (!applying) onClose(); };
  const ref = useDialogFocus(close);
  const speech = useSpeechCapture(setTranscript);
  useEffect(() => {
    if (error || speech.error) ref.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: "nearest" });
  }, [error, speech.error, ref]);
  useEffect(() => {
    // A disabled submit button can leave focus on <body> while a request runs.
    // Keep Escape and Tab working even then, without closing the panel underneath.
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!applying) onClose(); }
      if (event.key === "Tab" && ref.current && !ref.current.contains(document.activeElement)) {
        const controls = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter((item) => item.getClientRects().length);
        event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [applying, onClose, ref]);
  useEffect(() => {
    if (!session.pending) return;
    let cancelled = false;
    void recoverWorkspaceVoiceAction({ planId: session.pending.planId }).then((result) => {
      if (cancelled) return;
      setRecovering(false);
      if (!result.ok) { setError(result.error); return; }
      if (result.status === "applied") { onApplied(result.receipt); return; }
      if (result.status === "undone" || result.status === "expired") { onSession({ transcript, target, updatedAt: Date.now() }); setError(result.status === "undone" ? "Your earlier update was already undone. Nothing new has been applied." : "The earlier review expired without a save. You can prepare your words again."); return; }
      setReview({ ...result.review, plan: { ...result.review.plan, changes: session.pending!.changes } });
      setError("The earlier save was not completed. Check this review and retry Apply safely.");
    }).catch(() => { if (!cancelled) { setRecovering(false); setError("Could not check your earlier save. Close and reopen this panel to retry before creating another update."); } });
    return () => { cancelled = true; };
    // Only recover when opening the panel, not when Apply records its pending request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    active.current = true;
    void loadVoiceWorkspaceAction().then((result) => {
      if (!active.current) return;
      setLoading(false);
      if (!result.ok) { setError(result.error); return; }
      setChoices(result.choices); setAiConfigured(result.aiConfigured);
      setTarget((selected) => {
        if (!selected) return null;
        return result.choices.find((choice) => choiceKey(choice.target) === choiceKey(selected))?.target ?? result.choices.find((choice) => choice.target.id === selected.id && selected.kind === "delivery" && choice.target.kind === "direct")?.target ?? null;
      });
    }).catch(() => { if (active.current) { setLoading(false); setError("Could not load your records. Close this panel and try again."); } });
    return () => { active.current = false; };
  }, []);
  useEffect(() => { onSession({ transcript, target, updatedAt: Date.now(), ...(session.pending ? { pending: session.pending } : {}) }); }, [transcript, target, onSession, session.pending]);
  const selected = choices.find((choice) => target && choiceKey(choice.target) === choiceKey(target));
  const busy = preparing || applying || recovering;
  const captureIdle = speech.state === "idle";
  function prepare() {
    if (!target || !captureIdle || busy) return;
    setError("");
    startPrepare(async () => {
      try {
        const result = await prepareWorkspaceVoiceAction({ target, transcript, timezone });
        if (!active.current) return;
        if (!result.ok) { setError(result.error); return; }
        setReview(result);
      } catch { if (active.current) setError("Could not prepare the review. Your words are still here; try again."); }
    });
  }
  function apply(changes: VoiceChanges) {
    if (!review || applying) return;
    setError("");
    onSession({ transcript, target, updatedAt: Date.now(), pending: { planId: review.plan.id, changes } });
    startApply(async () => {
      try {
        const result = await applyWorkspaceVoiceAction({ planId: review.plan.id, changes });
        if (!active.current) return;
        if (!result.ok) { setError(result.error); return; }
        onApplied(result.receipt);
      } catch { if (active.current) setError("Could not confirm the save. Keep this review and retry Apply; it cannot create duplicates."); }
    });
  }
  function editWords() {
    if (!session.pending) { setReview(null); setError(""); return; }
    startPrepare(async () => {
      try {
        const result = await recoverWorkspaceVoiceAction({ planId: session.pending!.planId });
        if (!active.current) return;
        if (!result.ok) { setError(result.error); return; }
        if (result.status === "applied") { onApplied(result.receipt); return; }
        onSession({ transcript, target, updatedAt: Date.now() }); setReview(null); setError("");
      } catch { if (active.current) setError("Check the earlier save before changing the review. Try again."); }
    });
  }
  return <div className="dialog-backdrop workspace-voice-backdrop"><section ref={ref} className="dialog-card workspace-voice-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-voice-title">
    <header className="dialog-header"><div><span className="eyebrow">Talk to GUD</span><h2 id="workspace-voice-title">{review ? "One update. Ready to review." : "What happened? What’s next?"}</h2><p>{review ? "Keep what looks right. Adjust or untick anything else." : "Say it once. Review the changes. Get back to work."}</p></div><button type="button" className="icon-button" disabled={applying} onClick={close} aria-label="Close voice workspace"><X size={18} /></button></header>
    {review ? <VoiceReview review={review} timezone={timezone} pending={busy} error={error} onBack={editWords} onApply={apply} /> : <>
      <div className="workspace-voice-body">
        <div className="voice-target"><span className="voice-step-label">1 · Choose the record</span>{loading ? <p role="status"><LoaderCircle size={15} className="spin" />Loading your records…</p> : selected ? <div className="voice-selected"><div><small>{kindName(selected.target)}</small><strong>{selected.companyName}</strong><span>{selected.title}</span></div><button type="button" className="btn btn-quiet" disabled={busy || !captureIdle} onClick={() => setTarget(null)}>Change</button></div> : <><label className="search-box"><Search size={16} /><input aria-label="Find a voice record" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a client or project" /></label><div className="voice-record-list">{choices.filter((choice) => `${choice.companyName} ${choice.title}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map((choice) => <button type="button" key={choiceKey(choice.target)} onClick={() => setTarget(choice.target)}><span><strong>{choice.companyName}</strong><small>{choice.title}</small></span><em>{kindName(choice.target)}</em></button>)}{!choices.length ? <p>Add a sales record or live project first.</p> : null}</div><small>Choose explicitly when a client has more than one record.</small></>}</div>
        <div className="voice-capture-strip" data-listening={speech.state === "listening"}><div><span className="voice-step-label">2 · Talk or type</span><strong role="status">{speech.state === "listening" ? "Listening…" : speech.state === "stopping" ? "Finishing your last words…" : "Your words, your way"}</strong></div>{speech.supported ? <button type="button" className="btn btn-voice" disabled={busy || speech.state === "stopping"} onClick={() => captureIdle ? speech.start(transcript) : speech.stop()}>{captureIdle ? <Mic size={16} /> : <Square size={16} />}{captureIdle ? transcript ? "Add by voice" : "Start recording" : "Stop recording"}</button> : <small>Type below · microphone unavailable</small>}</div>
        <label className="voice-words-label">Your update<textarea data-autofocus aria-label="Your update" className="voice-workspace-transcript" rows={5} maxLength={12000} value={transcript} readOnly={busy || !captureIdle} onChange={(event) => setTranscript(event.target.value)} placeholder={selected?.target.kind === "direct" ? "The client approved the design. Move to In progress, set the project value to £12,500 and make the first draft the next milestone, due Friday." : "I spoke with Jamie. They approved the outline. Log the call and remind me to send the proposal on Friday at 10am."} /></label>
        <div className="voice-capture-footnote"><span>{recovering ? "Checking your earlier save…" : transcript ? "Draft kept in this browser tab for up to 24 hours." : "One record per update. Nothing is saved yet."}</span><button type="button" disabled={busy || !captureIdle || !transcript || Boolean(session.pending)} onClick={() => { setTranscript(""); setTarget(preferredTarget); setError(""); }}>Discard words</button></div>
        {selected?.target.kind === "direct" ? <p className="voice-context-help">For direct projects, capture updates in delivery notes and set the next milestone. Sales-linked projects can also log activities and create follow-up tasks.</p> : null}
        <p className="voice-privacy"><ShieldCheck size={15} />Your browser handles recognition and may use its speech service. Only your text and the selected record’s name, title and reference options go to the workspace AI when you request a review.</p>
        {!loading && !aiConfigured ? <p className="voice-setup-notice">An administrator needs to enable OpenAI in <Link href="/settings?tab=ai" onClick={close}>Settings → AI connections</Link>. You can still capture and keep your words here.</p> : null}
        {error || speech.error ? <p className="form-error" role="alert">{error || speech.error}</p> : null}
      </div>
      <footer className="workspace-voice-footer"><small>Nothing sent to clients. You approve every change.</small><button type="button" className="btn btn-primary" onClick={prepare} disabled={!selected || !aiConfigured || transcript.trim().length < 2 || busy || !captureIdle || Boolean(session.pending)}>{preparing ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}{preparing ? "Preparing review…" : "Review changes"}</button></footer>
    </>}
  </section></div>;
}

function VoiceReview({ review, timezone, pending, error, onBack, onApply }: { review: Review; timezone: string; pending: boolean; error: string; onBack: () => void; onApply: (changes: VoiceChanges) => void }) {
  const { plan, references } = review;
  const [changes, setChanges] = useState<VoiceChanges>(plan.changes);
  const [included, setIncluded] = useState<Set<keyof VoiceChanges>>(new Set(Object.keys(plan.changes) as Array<keyof VoiceChanges>));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(voiceFieldKeys.map((key) => [key, plan.changes[key]?.toString() ?? ""])));
  const [taskDate, setTaskDate] = useState(plan.changes.task?.dueAt ? voiceIsoToLocal(plan.changes.task.dueAt, timezone).slice(0, 10) : plan.taskDateHint ?? "");
  const [taskTime, setTaskTime] = useState(plan.changes.task?.dueAt ? voiceIsoToLocal(plan.changes.task.dueAt, timezone).slice(11) : "");
  const [activityTime, setActivityTime] = useState(plan.changes.activity ? voiceIsoToLocal(plan.changes.activity.occurredAt, timezone) : "");
  function include(key: keyof VoiceChanges) { setIncluded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  function proposed(): VoiceChanges {
    const result: Record<string, unknown> = {};
    for (const key of voiceFieldKeys) if (included.has(key)) result[key] = key === "salesValue" || key === "deliveryValue" ? values[key] === "" ? null : Number(values[key]) : key === "milestoneDate" ? values[key] || null : values[key];
    if (included.has("activity") && changes.activity) result.activity = { ...changes.activity, occurredAt: voiceLocalToIso(activityTime, timezone) };
    if (included.has("task") && changes.task) result.task = { ...changes.task, dueAt: taskDate && taskTime ? voiceLocalToIso(`${taskDate}T${taskTime}`, timezone) : null };
    return result as VoiceChanges;
  }
  const proposedChanges = proposed();
  const parsed = voiceChangesSchema.safeParse(proposedChanges);
  const needsTime = included.has("task") && !proposedChanges.task?.dueAt;
  const valid = parsed.success && included.size > 0 && !needsTime;
  function before(key: VoiceFieldKey) {
    const value = plan.before[key];
    if (key === "deliveryNote") return "Added to your existing notes";
    if (key === "salesStage") return references.salesStages.find((stage) => stage.id === value)?.name ?? String(value);
    if (key === "deliveryStage") return references.deliveryStages.find((stage) => stage.id === value)?.name ?? String(value);
    if (key === "salesValue" || key === "deliveryValue") return value == null ? "Not set" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value));
    return value === null || value === "" ? "Not set" : String(value).replaceAll("_", " ");
  }
  function editor(key: VoiceFieldKey) {
    const common = { "aria-label": voiceLabels[key], disabled: pending || !included.has(key), value: values[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues({ ...values, [key]: event.target.value }) };
    if (key === "salesStage" || key === "deliveryStage") return <select {...common}>{(key === "salesStage" ? references.salesStages : references.deliveryStages).map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}</select>;
    if (key === "priority" || key === "temperature") return <select {...common}>{(key === "priority" ? ["low", "medium", "high", "critical"] : ["cold", "warm", "hot", "at_risk", "unresponsive"]).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>;
    if (key === "deliveryNote") return <textarea {...common} rows={3} maxLength={5000} />;
    return <input {...common} type={key === "salesValue" || key === "deliveryValue" ? "number" : key === "milestoneDate" ? "date" : "text"} min={key.endsWith("Value") ? "0" : undefined} step={key.endsWith("Value") ? "0.01" : undefined} maxLength={240} />;
  }
  return <form className="workspace-voice-review" onSubmit={(event) => { event.preventDefault(); if (valid) onApply(proposedChanges); }}>
    <div className="workspace-voice-body"><div className="voice-review-record"><span>{kindName(plan.target)}</span><strong>{plan.companyName}</strong><p>{plan.title}</p></div>
      <p className="voice-review-intro">Only the checked items will be applied. Dates and times are in {timezone}.</p>
      <div className="voice-change-list">{voiceFieldKeys.filter((key) => key in plan.changes).map((key) => <div className="voice-change" key={key} data-included={included.has(key)}><label className="voice-change-check"><input type="checkbox" checked={included.has(key)} onChange={() => include(key)} disabled={pending} aria-label={`Include ${voiceLabels[key]}`} /><span>{voiceLabels[key]}<small>{before(key)}</small></span></label><div className="voice-change-editor">{editor(key)}</div></div>)}</div>
      {changes.activity ? <section className="voice-combined-card" data-included={included.has("activity")}><label className="voice-change-check"><input type="checkbox" checked={included.has("activity")} onChange={() => include("activity")} disabled={pending} /><span>Log what happened<small>One entry in the shared activity timeline</small></span></label><fieldset disabled={pending || !included.has("activity")}><select aria-label="Activity type" value={changes.activity.typeId} onChange={(event) => setChanges({ ...changes, activity: { ...changes.activity!, typeId: event.target.value } })}>{references.activityTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select><textarea aria-label="Activity notes" rows={3} value={changes.activity.notes} maxLength={5000} onChange={(event) => setChanges({ ...changes, activity: { ...changes.activity!, notes: event.target.value } })} /><div className="voice-review-pair"><label>When it happened<input type="datetime-local" aria-label="Activity time" value={activityTime} onChange={(event) => setActivityTime(event.target.value)} /></label><label>Outcome<input aria-label="Activity outcome" value={changes.activity.outcome ?? ""} maxLength={200} onChange={(event) => setChanges({ ...changes, activity: { ...changes.activity!, outcome: event.target.value || null } })} /></label></div></fieldset></section> : null}
      {changes.task ? <section className="voice-combined-card" data-included={included.has("task")}><label className="voice-change-check"><input type="checkbox" checked={included.has("task")} onChange={() => include("task")} disabled={pending} /><span>Set the next action<small>A CRM task for the record owner, or you if unassigned</small></span></label><fieldset disabled={pending || !included.has("task")}><input aria-label="Next action" value={changes.task.title} maxLength={240} onChange={(event) => setChanges({ ...changes, task: { ...changes.task!, title: event.target.value } })} /><div className="voice-review-pair"><label>Due date<input type="date" aria-label="Next action date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} /></label><label>Due time<input type="time" aria-label="Next action time" value={taskTime} onChange={(event) => setTaskTime(event.target.value)} /></label></div>{needsTime ? <p className="voice-review-hint">Choose a date and time before applying. Ambiguous clock-change times need a different time.</p> : null}</fieldset></section> : null}
      {!parsed.success ? <p className="form-error" role="alert">Check the amounts, text and activity time before applying.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
    </div><footer className="workspace-voice-footer"><button className="btn btn-quiet" type="button" disabled={pending} onClick={onBack}><ChevronLeft size={16} />Edit words</button><div><small>One save · Undo available for 15 minutes</small><button className="btn btn-primary" type="submit" disabled={pending || !valid}>{pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{pending ? "Applying…" : `Apply ${included.size} ${included.size === 1 ? "change" : "changes"}`}</button></div></footer>
  </form>;
}
