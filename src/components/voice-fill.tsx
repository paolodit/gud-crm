"use client";

import { LoaderCircle, Mic, Square, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { parseSpokenCrmDraftAction, type SpokenCrmDraft } from "@/app/actions/ai";

type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionConstructor = new () => Recognition;

export function VoiceFillButton({
  kind,
  onDraft,
  prominent = false,
}: {
  kind: "company" | "opportunity";
  onDraft: (draft: SpokenCrmDraft) => number;
  prominent?: boolean;
}) {
  const recognition = useRef<Recognition | null>(null);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "listening" | "thinking">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const browserWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    queueMicrotask(() => setSupported(Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition)));
    return () => recognition.current?.stop();
  }, []);

  async function start() {
    if (state === "listening") {
      recognition.current?.stop();
      setState("idle");
      return;
    }
    const browserWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const RecognitionApi = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!RecognitionApi) return setMessage("Voice input is not available in this browser.");
    const next = new RecognitionApi();
    recognition.current = next;
    next.lang = "en-GB";
    next.continuous = false;
    next.interimResults = false;
    next.onerror = () => { setState("idle"); setMessage("I could not hear that clearly. Nothing was saved."); };
    next.onend = () => setState((current) => current === "listening" ? "idle" : current);
    next.onresult = async (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (!transcript) return setMessage("I could not hear enough to fill the form.");
      setState("thinking");
      setMessage("Structuring your note…");
      const result = await parseSpokenCrmDraftAction({ kind, transcript });
      setState("idle");
      if (!result.ok) return setMessage(result.error);
      const count = onDraft(result.draft);
      setMessage(count ? `${count} ${count === 1 ? "field" : "fields"} filled. Review before saving.` : "I heard you, but found no new fields to add.");
    };
    setMessage("Listening… speak naturally; nothing is saved until you review the form.");
    setState("listening");
    next.start();
  }

  return (
    <div className="voice-fill" data-prominent={prominent} data-state={state}>
      <button className="btn btn-voice" type="button" onClick={start} disabled={!supported || state === "thinking"} title={supported ? "Talk through this record" : "Voice input needs a browser with speech recognition"}>
        {state === "thinking" ? <LoaderCircle className="spin" size={16} /> : state === "listening" ? <Square size={15} /> : <Mic size={16} />}
        {state === "listening" ? "Stop listening" : state === "thinking" ? "Structuring…" : prominent ? "Talk it through" : "Just talk"}
      </button>
      {state === "listening" ? <span className="voice-levels" aria-hidden="true">{[0, 1, 2, 3, 4].map((bar) => <i key={bar} />)}</span> : null}
      {message ? <span className="voice-fill-status" role="status" aria-live="polite" data-listening={state === "listening"}><Sparkles size={13} />{message}</span> : null}
    </div>
  );
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
