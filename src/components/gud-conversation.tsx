"use client";

import { Check, ChevronDown, LoaderCircle, Mic, MicOff, Send, Square, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOff, type GudDraft, type GudFields } from "@/lib/gud-actions/contract";
import "./gud-conversation.css";

type Message = { role: "user" | "assistant"; content: string };
type References = { offers: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string }>; projectStages: Array<{ id: string; name: string }>; thoughtsAllowed: boolean };
type Session = { id: string; expiresAt: string };
type Result = { error?: string; session?: Session; references?: References; drafts?: GudDraft[]; draft?: GudDraft; message?: string; events?: Result[]; navigate?: string; finish?: boolean; sdp?: string; receipts?: Array<{ draftId: string; href: string; label: string }> };
const protectedEditor = () => document.querySelector('.dialog-card:not(.workspace-voice-dialog):not([data-gud-navigation-safe="true"]), .inline-detail-form');
async function api(op: string, input?: unknown, sessionId?: string): Promise<Result> {
  const response = await fetch("/api/gud-conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, input, sessionId }) });
  const result = await response.json() as Result;
  if (!response.ok || result.error) throw new Error(result.error || "GUD couldn’t complete that step. Your drafts are safe.");
  return result;
}

export function GudConversation({ onClassic }: { onClassic: () => void }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const [open, setOpen] = useState(false), [minimised, setMinimised] = useState(false);
  const [session, setSession] = useState<Session | null>(null), [drafts, setDrafts] = useState<GudDraft[]>([]);
  const [references, setReferences] = useState<References | null>(null);
  const [messages, setMessages] = useState<Message[]>([]), [text, setText] = useState("");
  const [status, setStatus] = useState("Ready when you are"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [voice, setVoice] = useState(false), [muted, setMuted] = useState(false), [consent, setConsent] = useState(false);
  const [edits, setEdits] = useState<Record<string, GudFields>>({});
  const editsRef = useRef<Record<string, GudFields>>({}), ending = useRef(false);
  useEffect(() => { editsRef.current = edits; }, [edits]);
  const sessionRef = useRef<Session | null>(null), draftsRef = useRef<GudDraft[]>([]), busyRef = useRef(false), saved = useRef(false);
  const peer = useRef<RTCPeerConnection | null>(null), channel = useRef<RTCDataChannel | null>(null), media = useRef<MediaStream | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const lastActivity = useRef(0), seenCalls = useRef(new Set<string>()), queue = useRef(Promise.resolve()), generation = useRef(0);
  const context = useRef({ page: pathname, recordId: params.get("opportunity") ?? params.get("project"), timezone: "Europe/London" });
  const contextKey = `${pathname}:${params.get("opportunity") ?? params.get("project") ?? ""}`;
  useEffect(() => { context.current = { page: pathname, recordId: params.get("opportunity") ?? params.get("project"), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }; }, [pathname, params]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const lock = (value: boolean) => { busyRef.current = value; setBusy(value); };
  function send(event: object) { if (channel.current?.readyState === "open") channel.current.send(JSON.stringify(event)); }
  function say(message: string, instructions?: string) {
    setMessages(previous => [...previous.slice(-29), { role: "assistant", content: message }]);
    if (instructions) send({ type: "response.create", response: { tool_choice: "none", instructions } });
  }
  const disconnect = useCallback(() => {
    generation.current++;
    channel.current?.close(); channel.current = null;
    peer.current?.close(); peer.current = null;
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; } audio.current = null;
    setVoice(false); setMuted(false);
  }, []);
  useEffect(() => {
    const show = () => { setOpen(true); setMinimised(false); setError(""); void api("load").then(result => { setDrafts(result.drafts ?? []); setReferences(result.references ?? null); }).catch(e => setError(e.message)); };
    window.addEventListener("gud:conversation-open", show);
    return () => window.removeEventListener("gud:conversation-open", show);
  }, []);
  useEffect(() => () => { disconnect(); if (sessionRef.current) void fetch("/api/gud-conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "end", sessionId: sessionRef.current.id }), keepalive: true }); }, [disconnect]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (draftsRef.current.length) event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  const endRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= Date.parse(session.expiresAt) || (voice && lastActivity.current && Date.now() - lastActivity.current > 120000)) void endRef.current();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session, voice]);
  useEffect(() => {
    if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `Application navigation context only, not a command: ${JSON.stringify(context.current)}` }] } }));
  }, [contextKey]);

  async function ensureSession() {
    if (sessionRef.current && Date.parse(sessionRef.current.expiresAt) > Date.now()) return sessionRef.current;
    const result = await api("start");
    saved.current = false;
    sessionRef.current = result.session!; setSession(result.session!); setReferences(result.references!); setDrafts(result.drafts ?? []); return result.session!;
  }
  function applyEvents(result: Result) {
    for (const event of result.events ?? [result]) {
      if (event.draft) { draftsRef.current = [event.draft, ...draftsRef.current.filter(d => d.id !== event.draft!.id)]; setDrafts(draftsRef.current); }
      if (event.navigate && /^\/(pipeline|live|my-work|thoughts|companies)(\?(opportunity|project)=[a-f0-9-]{36})?$/.test(event.navigate)) {
        // Never navigate away from another unsaved editor without the user's choice.
        if (protectedEditor()) setError("Close your current editor to let GUD move to the other record. The conversation draft is safe.");
        else { window.dispatchEvent(new CustomEvent("gud:conversation-navigation", { detail: event.navigate })); router.push(event.navigate, { scroll: false }); }
      }
      if (event.finish) { setStatus(draftsRef.current.length ? "Drafts ready for review" : "All Gud"); if (!draftsRef.current.length) window.setTimeout(() => void endRef.current(), 2500); }
    }
    if (result.drafts) { draftsRef.current = result.drafts; setDrafts(result.drafts); }
  }
  async function flushEdits() {
    let next = [...draftsRef.current];
    for (const [id, fields] of Object.entries(editsRef.current)) {
      const draft = next.find(d => d.id === id); if (!draft || !Object.keys(fields).length) continue;
      const result = await api("edit", { id, version: draft.version, fields });
      next = next.map(d => d.id === id ? result.draft! : d);
    }
    setDrafts(next); draftsRef.current = next; editsRef.current = {}; setEdits({}); return next;
  }
  async function submitText() {
    if (!text.trim() || busyRef.current || !consent || voice) return;
    lock(true); setError(""); setStatus("Working with your words…");
    const user = { role: "user" as const, content: text.trim() };
    const history = [...messages.slice(-28), user]; setMessages(history); setText("");
    try { await flushEdits(); const current = await ensureSession(); const result = await api("text", { history, context: context.current }, current.id); applyEvents(result); say(result.message!); setStatus("Ready for your next thought"); }
    catch (e) { setError((e as Error).message); setStatus("Your drafts are safe"); }
    finally { lock(false); }
  }
  async function startVoice() {
    if (busyRef.current || voice || !consent) return;
    lock(true); setError(""); setStatus("Connecting voice…");
    const token = ++generation.current;
    try {
      await flushEdits();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      media.current = stream;
      const current = await ensureSession();
      const connection = new RTCPeerConnection(); peer.current = connection;
      const output = new Audio(); output.autoplay = true; audio.current = output;
      connection.ontrack = event => { output.srcObject = event.streams[0]; void output.play().catch(() => setError("Use Play voice to allow GUD’s audio in this browser.")); };
      stream.getTracks().forEach(track => connection.addTrack(track, stream));
      const dc = connection.createDataChannel("oai-events"); channel.current = dc; seenCalls.current.clear();
      dc.onopen = () => { setVoice(true); setStatus("Listening"); lastActivity.current = Date.now(); };
      connection.onconnectionstatechange = () => { if (["failed", "disconnected"].includes(connection.connectionState)) { disconnect(); setError("Voice disconnected. Your drafts are safe. End this conversation, then reconnect or continue typing."); } };
      dc.onmessage = event => {
        if (token !== generation.current) return;
        let value: Record<string, unknown>; try { value = JSON.parse(event.data); } catch { return; }
        if (value.type === "input_audio_buffer.speech_started") { lastActivity.current = Date.now(); setStatus("Listening…"); }
        if (value.type === "response.created") setStatus("GUD is thinking…");
        if (value.type === "response.output_audio.delta" || value.type === "output_audio_buffer.started") setStatus("GUD is speaking…");
        if (value.type === "output_audio_buffer.stopped") setStatus("Listening");
        if (value.type === "conversation.item.input_audio_transcription.completed" && typeof value.transcript === "string") setMessages(previous => [...previous.slice(-29), { role: "user", content: value.transcript as string }]);
        if (value.type === "response.output_audio_transcript.done" && typeof value.transcript === "string") setMessages(previous => [...previous.slice(-29), { role: "assistant", content: value.transcript as string }]);
        if (value.type === "error") setError("The voice provider interrupted a response. Your drafts are safe; try again or continue by typing.");
        if (value.type === "response.done") {
          const response = value.response as { output?: Array<{ type: string; name: string; arguments: string; call_id: string }>; usage?: { input_tokens: number; output_tokens: number } } | undefined;
          if (response?.usage) void api("usage", { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }, current.id).catch(() => {});
          const calls = response?.output?.filter(item => item.type === "function_call") ?? [];
          if (!calls.length) return;
          queue.current = queue.current.then(async () => {
            if (token !== generation.current) return;
            lock(true); setStatus("Preparing your changes…");
            try {
              await flushEdits();
              for (const call of calls.slice(0, 8)) {
                if (token !== generation.current) return;
                if (seenCalls.current.has(call.call_id)) continue;
                seenCalls.current.add(call.call_id);
                let result: Result;
                try { result = await api("tool", { name: call.name, arguments: JSON.parse(call.arguments), context: context.current }, current.id); applyEvents(result); }
                catch (e) { result = { error: (e as Error).message }; setError(result.error!); }
                send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
              }
              send({ type: "response.create" });
            } finally { lock(false); }
          }).catch(() => { lock(false); setError("That action was interrupted. Review your drafts before retrying."); });
        }
      };
      const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
      const result = await api("voice", { sdp: offer.sdp, context: context.current }, current.id);
      if (token !== generation.current) return;
      await connection.setRemoteDescription({ type: "answer", sdp: result.sdp! });
    } catch (e) { disconnect(); if (sessionRef.current) { void api("end", undefined, sessionRef.current.id).catch(() => {}); sessionRef.current = null; setSession(null); } setError((e as Error).message || "Voice could not connect. Typing still works."); setStatus("Ready to type"); }
    finally { lock(false); }
  }
  async function end() {
    if (ending.current) return false;
    ending.current = true;
    const current = sessionRef.current;
    disconnect(); setStatus("Conversation ended");
    try {
      if (current) { await api("end", undefined, current.id); sessionRef.current = null; setSession(null); }
      await flushEdits();
      say(signOff(saved.current, draftsRef.current.length));
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { ending.current = false; }
  }
  useEffect(() => { endRef.current = async () => { await end(); }; });
  async function save() {
    if (busyRef.current) return;
    if (protectedEditor()) { setError("Save or close the other editor before applying your conversation drafts."); return; }
    lock(true); setError(""); setStatus("Saving reviewed changes…");
    // Pause input while the user commits the visible review.
    media.current?.getAudioTracks().forEach(track => { track.enabled = false; }); setMuted(voice);
    send({ type: "response.cancel" });
    try {
      const reviewed = await flushEdits();
      const result = await api("save", reviewed.map(d => ({ id: d.id, version: d.version })));
      setDrafts(result.drafts ?? []); draftsRef.current = result.drafts ?? []; saved.current = true;
      const message = signOff(true, draftsRef.current.length);
      say(message, `The application confirms the reviewed changes were saved successfully. Say exactly: ${message}`);
      setStatus("All Gud · saved"); window.dispatchEvent(new Event("gud:conversation-saved")); router.refresh();
      if (result.receipts?.at(-1)?.href) router.push(result.receipts.at(-1)!.href, { scroll: false });
    } catch (e) { setError((e as Error).message); setStatus("Not saved · review needed"); }
    finally { lock(false); }
  }
  async function cancel(draft: GudDraft) {
    if (busyRef.current) return; lock(true); setError("");
    try { const result = await api("cancel", { id: draft.id, version: draft.version }); setDrafts(result.drafts ?? []); setEdits(previous => { const next = { ...previous }; delete next[draft.id]; return next; }); }
    catch (e) { setError((e as Error).message); } finally { lock(false); }
  }
  if (!open) return null;
  return createPortal(<aside className={`gud-conversation ${minimised ? "is-minimised" : ""}`} aria-label="GUD conversation preview">
    <header><div><strong>Talk to GUD</strong><small>Conversation preview</small></div><button type="button" className="icon-button" aria-label={minimised ? "Expand conversation" : "Minimise conversation"} onClick={() => setMinimised(!minimised)}><ChevronDown size={17} /></button><button type="button" className="icon-button" aria-label="Close conversation" onClick={() => { void end().then(ended => { if (ended) { setOpen(false); document.querySelector<HTMLButtonElement>(".workspace-voice-launch")?.focus(); } }); }} disabled={busy}><X size={17} /></button></header>
    <div className="gud-conversation-status" role="status">{busy ? <LoaderCircle className="spin" size={15} /> : voice ? <Mic size={15} /> : <Check size={15} />}{status}{drafts.length ? <span>{drafts.length} unsaved</span> : null}</div>
    {!minimised ? <>
      <div className="gud-conversation-scroll">
        {!consent ? <div className="gud-conversation-intro"><p>Tell GUD what happened. It will find the right screen and prepare changes for you to review.</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Send my conversation and relevant CRM details to OpenAI. Voice uses my microphone only after I start it.</label><small>No whole-database upload. No CRM changes until Save. Drafts are private to this account. Voice stops after 2 minutes idle or 10 minutes total.</small></div> : null}
        {messages.length ? <div className="gud-conversation-messages" aria-live="polite">{messages.slice(-2).map((message, i) => <p key={`${messages.length}-${i}`} data-role={message.role}><small>{message.role === "user" ? "You" : "GUD"}</small>{message.content}</p>)}{messages.length > 2 ? <details><summary>Conversation history</summary>{messages.slice(0, -2).map((m, i) => <p key={i}><small>{m.role === "user" ? "You" : "GUD"}</small>{m.content}</p>)}</details> : null}</div> : null}
        {drafts.map(draft => <DraftCard key={draft.id} draft={draft} fields={{ ...draft.fields, ...edits[draft.id] }} references={references} busy={busy} onEdit={(key, value) => setEdits(previous => ({ ...previous, [draft.id]: { ...previous[draft.id], [key]: value } }))} onCancel={() => void cancel(draft)} />)}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer>
        {drafts.length ? <button type="button" className="btn btn-primary gud-save" onClick={() => void save()} disabled={busy}>Save {drafts.length === 1 ? "changes" : `all ${drafts.length} drafts`}</button> : null}
        <form onSubmit={event => { event.preventDefault(); void submitText(); }}><textarea aria-label="Message GUD" placeholder="What are you working on?" maxLength={12000} value={text} onChange={e => setText(e.target.value)} disabled={busy || voice} rows={2} /><button type="submit" className="icon-button" aria-label="Send message to GUD" disabled={!text.trim() || busy || !consent || voice}><Send size={17} /></button></form>
        <div className="gud-conversation-controls">{!voice ? <button type="button" className="btn btn-voice" onClick={() => void startVoice()} disabled={busy || !consent}><Mic size={15} />Start conversation</button> : <><button type="button" className="btn btn-quiet" onClick={() => { media.current?.getAudioTracks().forEach(track => { track.enabled = muted; }); setMuted(!muted); }}><MicOff size={15} />{muted ? "Resume mic" : "Mute"}</button><button type="button" className="btn btn-quiet" onClick={() => void audio.current?.play()}>Play voice</button></>}{session ? <button type="button" className="btn btn-quiet" onClick={() => void end()} disabled={busy}><Square size={13} />End</button> : null}</div>
        <button className="gud-classic" type="button" disabled={voice || busy} onClick={() => { void end().then(ended => { if (ended) { setOpen(false); onClassic(); } }); }}>Use classic voice review</button>
      </footer>
    </> : null}
  </aside>, document.body);
}

const fieldLabels: Partial<Record<keyof GudFields, string>> = { company: "Company", title: "Title", contact: "Contact name", value: "Value (£)", note: "Append note", task: "Follow-up task", dueDate: "Due date", dueTime: "Time", body: "Private thought" };
function DraftCard({ draft, fields, references, busy, onEdit, onCancel }: { draft: GudDraft; fields: GudFields; references: References | null; busy: boolean; onEdit: (key: keyof GudFields, value: unknown) => void; onCancel: () => void }) {
  const keys: Array<keyof GudFields> = draft.kind === "thought" ? ["title", "body"] : draft.kind === "lead" ? [...(!draft.targetId ? ["company", "title", "contact"] as const : fields.title !== undefined ? ["title"] as const : []), ...(fields.value !== undefined ? ["value"] as const : []), "note", "task", ...(fields.task ? ["dueDate", "dueTime"] as const : [])] : [...(!draft.targetId || fields.company !== undefined ? ["company"] as const : []), ...(!draft.targetId || fields.title !== undefined ? ["title"] as const : []), ...(fields.value !== undefined ? ["value"] as const : []), "note", "task", ...(fields.dueDate ? ["dueDate"] as const : [])];
  return <section className="gud-draft" aria-label={`Draft ${draft.label}`}><div className="gud-draft-heading"><span>Draft · {draft.kind === "thought" ? "private" : draft.kind}</span><button type="button" aria-label={`Cancel draft ${draft.label}`} className="icon-button" onClick={onCancel} disabled={busy}><X size={14} /></button></div><strong>{draft.label}</strong>
    {keys.map(key => <label key={key}>{key === "task" && draft.kind === "project" ? "Add to project list" : key === "dueDate" && draft.kind === "project" ? "Project milestone date" : fieldLabels[key]}{key === "note" || key === "body" ? <textarea aria-label={fieldLabels[key]} rows={key === "body" ? 4 : 2} maxLength={key === "body" ? 20000 : 5000} value={String(fields[key] ?? "")} onChange={e => onEdit(key, e.target.value)} disabled={busy} /> : <input aria-label={fieldLabels[key]} type={key === "value" ? "number" : key === "dueDate" ? "date" : key === "dueTime" ? "time" : "text"} min={key === "value" ? "0" : undefined} step={key === "value" ? "0.01" : undefined} value={String(fields[key] ?? "")} onChange={e => onEdit(key, key === "value" ? Number(e.target.value) : e.target.value)} disabled={busy} />}</label>)}
    {draft.kind === "lead" && (!draft.targetId || fields.offerId) ? <label>Offer<select aria-label="Draft offer" value={fields.offerId ?? ""} onChange={e => onEdit("offerId", e.target.value)} disabled={busy}><option value="">Choose offer</option>{references?.offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
    {draft.kind !== "thought" && (fields.stageId || !draft.targetId) ? <label>Stage<select aria-label="Draft stage" value={fields.stageId ?? ""} onChange={e => onEdit("stageId", e.target.value)} disabled={busy}><option value="">Choose stage</option>{(draft.kind === "lead" ? references?.stages : references?.projectStages)?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
    {fields.completeTaskIds?.length ? <div><small>Mark complete</small>{fields.completeTaskIds.map(id => <p key={id}><Check size={13} />{draft.taskOptions?.find(t => t.id === id)?.title ?? "Selected task"}</p>)}</div> : null}
    {fields.dueTime ? <small>Time zone: {draft.timezone}</small> : null}
    {draft.warnings.map(w => <small className="gud-draft-warning" key={w}>{w}</small>)}
    <small>Nothing changes in the CRM until you save.</small>
  </section>;
}
