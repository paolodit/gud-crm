"use client";

import { LoaderCircle, Mic, Square, X, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { parseSpokenCrmDraftAction, type SpokenCrmDraft } from "@/app/actions/ai";
import { useDialogFocus } from "./use-dialog-focus";

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
type VoiceProps = {
  kind: "company" | "opportunity" | "activity_update" | "delivery_update";
  onDraft: (draft: SpokenCrmDraft) => number;
  prominent?: boolean; aiConfigured?: boolean; opportunityId?: string; initiallyOpen?: boolean;
};

export function VoiceFillButton({ prominent = false, initiallyOpen = false, ...props }: VoiceProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);
  const [message, setMessage] = useState("");
  return <div className="voice-fill" data-prominent={prominent}>
    <button className="btn btn-voice" type="button" onClick={() => setOpen(true)}><Mic size={16} />{props.kind.endsWith("_update") ? "Talk through an update" : prominent ? "Talk it through" : "Just talk"}</button>
    {message ? <span className="voice-fill-status" role="status">{message}</span> : null}
    {open && mounted ? createPortal(<VoiceCapture {...props} onClose={() => setOpen(false)} onDraft={(draft) => { const count = props.onDraft(draft); setMessage(count ? `${count} fields prepared. Review before saving.` : "No fields matched. You can fill them manually."); setOpen(false); return count; }} />, document.body) : null}
  </div>;
}

function VoiceCapture({ kind, onDraft, onClose, aiConfigured = true, opportunityId }: VoiceProps & { onClose: () => void }) {
  const ref = useDialogFocus(onClose);
  const recognition = useRef<Recognition | null>(null);
  const active = useRef(true);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "listening" | "thinking">("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState(0);
  const prompts = kind === "delivery_update" ? ["What has changed on this project?", "Which delivery stage should it be in?", "What is the next milestone, and when is it due?"] : kind === "activity_update" ? ["What happened, and who was involved?", "Was it a call, an email, a meeting or a reply?", "What should happen next, and when?"] : ["What could you help them achieve?", "Who is the organisation and the contact?", "Why now? How warm is it, and what is it worth?", "What is the sensible next move?"];
  useEffect(() => {
    active.current = true;
    const browser = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    queueMicrotask(() => setSupported(Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition)));
    return () => {
      active.current = false;
      const current = recognition.current;
      if (current) { current.onend = null; current.onresult = null; current.onerror = null; current.abort(); }
      recognition.current = null;
    };
  }, []);
  useEffect(() => {
    if (state !== "listening") return;
    const timer = window.setInterval(() => setHint((value) => (value + 1) % prompts.length), 5000);
    return () => window.clearInterval(timer);
  }, [state, prompts.length]);
  function start() {
    const browser = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Api = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Api) return;
    const next = new Api(); recognition.current = next;
    const before = transcript.trim();
    next.lang = "en-GB"; next.continuous = true; next.interimResults = true;
    next.onresult = (event) => { if (active.current) setTranscript([before, Array.from(event.results).map((item) => item[0]?.transcript ?? "").join(" ")].filter(Boolean).join(" ").slice(0, 12000)); };
    next.onerror = (event) => {
      if (!active.current) return;
      setState("idle");
      setError(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser, or type below." : "Recording stopped. Your words are still here; edit them or try again.");
    };
    next.onend = () => { recognition.current = null; if (active.current) setState("idle"); };
    setError(""); setState("listening");
    try { next.start(); } catch { recognition.current = null; setState("idle"); setError("Could not start the microphone. You can type your update below."); }
  }
  async function prepare() {
    if (!transcript.trim() || state !== "idle") return;
    setState("thinking"); setError("");
    try {
      const result = await parseSpokenCrmDraftAction({ kind, transcript, opportunityId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (!active.current) return;
      if (!result.ok) { setError(result.error); setState("idle"); return; }
      onDraft(result.draft);
    } catch { if (active.current) { setError("Could not prepare that update. Your transcript is still here; try again."); setState("idle"); } }
  }
  return <div className="dialog-backdrop voice-dialog-backdrop"><section ref={ref} className="dialog-card voice-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-title">
    <header className="dialog-header"><div><span className="eyebrow">Say it. Shape it. Save it.</span><h2 id="voice-title">{kind.endsWith("_update") ? "What’s changed?" : "Tell us the story"}</h2><p>{kind === "delivery_update" ? "Prepare a delivery stage, milestone or note. Review before saving." : kind === "activity_update" ? "Log a touchpoint and set a next action in one update." : "Turn a rough thought into a useful record."}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cancel voice input"><X size={18} /></button></header>
    <div className="dialog-form"><div className="voice-capture-stage" data-listening={state === "listening"}><Mic size={28} /><strong>{state === "listening" ? "Listening to you…" : "Speak naturally, or write it down"}</strong><p>{prompts[hint]}</p>{supported ? <button type="button" className="btn btn-voice" disabled={state === "thinking"} onClick={() => state === "listening" ? recognition.current?.stop() : start()}>{state === "listening" ? <Square size={16} /> : <Mic size={16} />}{state === "listening" ? "Stop recording" : transcript ? "Add more by voice" : "Start recording"}</button> : <p>Speech recognition isn’t available here. Typing works just as well.</p>}</div>
      <label className="field-label">Your words — editable<textarea data-autofocus className="field-textarea voice-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} readOnly={state !== "idle"} maxLength={12000} rows={5} placeholder={kind === "delivery_update" ? "Move this to client review. The next milestone is approval on 18 September. The first draft is ready…" : kind === "activity_update" ? "I spoke to Jamie this morning. They liked the proposal. Follow up next Tuesday at 10am…" : "We could build a booking website for Northbank. Jamie is interested; about £8,000…"} /></label>
      <p className="muted">Your browser handles speech recognition. Only the text you choose to prepare is sent to the workspace’s AI. Nothing is saved or sent to contacts automatically.</p>
      {!aiConfigured ? <p className="voice-setup-notice">An administrator needs to connect OpenAI in <Link href="/settings?tab=ai">Settings → AI coach</Link> before GUD can prepare fields. You can still copy your words and enter them manually.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div><footer className="dialog-actions"><button type="button" className="btn btn-quiet" onClick={() => setTranscript("")} disabled={state !== "idle" || !transcript}><RotateCcw size={14} />Clear</button><button type="button" className="btn btn-primary" disabled={!aiConfigured || transcript.trim().length < 2 || state !== "idle"} onClick={() => void prepare()}>{state === "thinking" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{state === "thinking" ? "Preparing…" : "Prepare for review"}</button></footer>
    </section></div>;
}

export function applySpokenDraft(form: HTMLFormElement | null, values: Record<string, unknown>) {
  if (!form) return 0;
  let filled = 0;
  for (const [name, rawValue] of Object.entries(values)) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const field = form.elements.namedItem(name);
    if (field instanceof RadioNodeList) {
      const radio = Array.from(field).find((item) => item instanceof HTMLInputElement && item.value === String(rawValue));
      if (!(radio instanceof HTMLInputElement)) continue;
      radio.checked = true;
      radio.dataset.voiceFilled = "true";
      window.setTimeout(() => delete radio.dataset.voiceFilled, 2400);
      filled += 1;
      continue;
    }
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) continue;
    if (!(field instanceof HTMLSelectElement) && field.value.trim()) continue;
    let value = String(rawValue);
    if (field instanceof HTMLSelectElement && ![...field.options].some((item) => item.value === value)) {
      const option = [...field.options].find((item) => item.text.trim().toLowerCase() === value.trim().toLowerCase());
      if (!option) continue;
      value = option.value;
    }
    field.value = value;
    field.dataset.voiceFilled = "true";
    window.setTimeout(() => delete field.dataset.voiceFilled, 2400);
    filled += 1;
  }
  return filled;
}
