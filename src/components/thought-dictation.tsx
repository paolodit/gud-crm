"use client";
import { useState } from "react";
import { Mic, Square } from "lucide-react";
import { useSpeechCapture } from "./use-speech-capture";

export function ThoughtDictation({ onApply, onClose, disabled = false }: { onApply: (text: string, replace: boolean) => void; onClose: () => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const speech = useSpeechCapture(setText);
  return <section className="thought-dictation" aria-label="Voice draft">
    <p>Speak your changes, then review before applying. Audio may be processed by your browser’s speech service; GUD does not store it.</p>
    <button type="button" className="btn btn-secondary" disabled={disabled || !speech.supported || speech.state === "stopping"} onClick={() => speech.state === "listening" ? speech.stop() : speech.start(text)}>{speech.state === "listening" ? <Square size={15} /> : <Mic size={15} />}{speech.state === "listening" ? "Stop recording" : "Start recording"}</button>
    {!speech.supported ? <small>Speech is unavailable here. You can type your changes below.</small> : null}
    {speech.error ? <p role="alert">{speech.error}</p> : null}
    <textarea aria-label="Voice draft text" rows={3} value={text} maxLength={4000} disabled={disabled || speech.state !== "idle"} onChange={e => setText(e.target.value)} />
    <label className="thought-research"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace existing text instead of adding</label>
    <div className="button-row"><button type="button" className="btn btn-primary" disabled={disabled || !text.trim() || speech.state !== "idle"} onClick={() => onApply(text, replace)}>Apply to draft</button><button type="button" className="btn btn-quiet" disabled={speech.state !== "idle"} onClick={onClose}>Cancel voice edit</button></div>
  </section>;
}
