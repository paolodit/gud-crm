"use client";

import { LoaderCircle, Mic, Square, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { parseSpokenCrmDraftAction, type SpokenCrmDraft } from "@/app/actions/ai";

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
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
  const processing = useRef(false);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "listening" | "thinking">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [heard, setHeard] = useState("");

  useEffect(() => {
    const browserWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    queueMicrotask(() => setSupported(Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition)));
    return () => recognition.current?.stop();
  }, []);

  async function start() {
    if (state === "listening") {
      setMessage("Finishing your note…");
      recognition.current?.stop();
      return;
    }
    const browserWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const RecognitionApi = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!RecognitionApi) return setMessage("Voice input is not available in this browser.");
    const next = new RecognitionApi();
    recognition.current = next;
    processing.current = false;
    setHeard("");
    next.lang = "en-GB";
    next.continuous = true;
    next.interimResults = true;
    let transcript = "";
    let failed = false;
    next.onerror = () => {
      failed = true;
      recognition.current = null;
      setState("idle");
      setMessage("I could not hear that clearly. Nothing was saved.");
    };
    next.onresult = (event) => {
      transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      setHeard(transcript);
    };
    next.onend = () => {
      recognition.current = null;
      if (failed || processing.current) return;
      if (!transcript) {
        setState("idle");
        setMessage("I could not hear enough to fill the form.");
        return;
      }
      void structureTranscript(transcript);
    };
    setMessage("Listening… speak naturally; nothing is saved until you review the form.");
    setState("listening");
    next.start();
  }

  async function structureTranscript(transcript: string) {
    if (processing.current) return;
    processing.current = true;
    setState("thinking");
    setMessage("Structuring your note…");
    const result = await parseSpokenCrmDraftAction({ kind, transcript });
    processing.current = false;
    setState("idle");
    if (!result.ok) return setMessage(result.error);
    const count = onDraft(result.draft);
    setMessage(count ? `${count} ${count === 1 ? "field" : "fields"} filled. Review before saving.` : "I heard you, but found no new fields to add.");
  }

  return (
    <div className="voice-fill" data-prominent={prominent} data-state={state}>
      <button className="btn btn-voice" type="button" onClick={start} disabled={!supported || state === "thinking"} title={supported ? "Talk through this record" : "Voice input needs a browser with speech recognition"}>
        {state === "thinking" ? <LoaderCircle className="spin" size={16} /> : state === "listening" ? <Square size={15} /> : <Mic size={16} />}
        {state === "listening" ? "Finish and fill" : state === "thinking" ? "Structuring…" : prominent ? "Talk it through" : "Just talk"}
      </button>
      {state === "listening" ? (
        <span className="voice-live" role="status" aria-live="polite">
          <span className="voice-live-label"><i />Listening now</span>
          <span className="voice-levels" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map((bar) => <i key={bar} />)}</span>
          <span className="voice-live-copy">{heard || "Start speaking — your words will appear here."}</span>
        </span>
      ) : null}
      {message && state !== "listening" ? <span className="voice-fill-status" role="status" aria-live="polite"><Sparkles size={13} />{message}</span> : null}
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
