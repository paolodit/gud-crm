"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Keep an overlay mounted for its exit animation; honour reduced motion. */
export function useExitTransition(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onClose);
  useEffect(() => { callback.current = onClose; }, [onClose]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback(() => {
    if (timer.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { callback.current(); return; }
    setClosing(true);
    timer.current = setTimeout(() => callback.current(), 180);
  }, []);
  return { closing, close };
}
