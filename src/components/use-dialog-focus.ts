"use client";

import { useEffect, useRef } from "react";

/** Contain keyboard focus and restore the invoking control on dismissal. */
export function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (!root) return;
    const controls = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((item) => item.getClientRects().length);
    (root.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? root).focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !root!.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root!.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    root.addEventListener("keydown", keydown);
    return () => { root.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return ref;
}
