"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type BrowserSpeech = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function useSpeechCapture(onWords: (words: string) => void) {
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onWords);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onWords; }, [onWords]);
  useEffect(() => {
    const browser = window as typeof window & BrowserSpeech;
    queueMicrotask(() => setSupported(Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition)));
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      const current = recognition.current;
      if (current) { current.onresult = null; current.onerror = null; current.onend = null; current.abort(); }
      recognition.current = null;
    };
  }, []);
  function start(before: string) {
    if (recognition.current) return;
    const browser = window as typeof window & BrowserSpeech;
    const Api = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Api) { setError("Speech recognition is not available in this browser. You can type your update below."); return; }
    const next = new Api(); recognition.current = next;
    next.lang = "en-GB"; next.continuous = true; next.interimResults = true;
    next.onresult = (event) => callback.current([before.trim(), Array.from(event.results).map((item) => item[0]?.transcript ?? "").join(" ")].filter(Boolean).join(" ").slice(0, 12000));
    next.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser, or type your update." : "Recording stopped. Your words are still here; continue typing or try the microphone again.");
      setState("idle");
    };
    next.onend = () => { if (stopTimer.current) clearTimeout(stopTimer.current); recognition.current = null; setState("idle"); };
    setError(""); setState("listening");
    try { next.start(); } catch { recognition.current = null; setState("idle"); setError("Could not start the microphone. Typing works too."); }
  }
  function stop() {
    const current = recognition.current;
    if (!current) return;
    setState("stopping");
    try { current.stop(); } catch { current.abort(); recognition.current = null; setState("idle"); }
    stopTimer.current = setTimeout(() => {
      if (recognition.current === current) { current.abort(); recognition.current = null; setState("idle"); setError("Recording has stopped. Check your last sentence before reviewing."); }
    }, 4000);
  }
  return { supported, state, error, start, stop };
}
